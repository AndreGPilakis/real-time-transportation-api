const axios = require('axios');
const crypto = require('crypto');
const moment = require('moment');
var mysql = require('mysql');


const baseURL = 'https://timetableapi.ptv.vic.gov.au';
const apiKey = process.env.API_KEY;
const devID = process.env.DEV_ID;

const dbHost = process.env.DB_HOST;
const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASSWORD;
const dbName = process.env.DB_NAME;
const searchTime = process.env.SEARCH_TIME

var currentTime = true;

//Connecting to db
var con = mysql.createConnection({
    host: dbHost,
    user: dbUser,
    password: dbPass,
    database: dbName
  });

//Created tables if needed
initializeDatabase(con);

// Time of last Client API call
let lastUpdate;

// Generate signature for the API request
function encryptSignature(url) {
    return crypto.createHmac('sha1', apiKey).update(url).digest('hex');
}


// Compares 2 stops, checks which will arrive first
function compareStops(a, b) {
    const aStopSequence = a.stop_sequence;
    const bStopSequence = b.stop_sequence;

    let comparison = 0;
    if (aStopSequence > bStopSequence) {
        comparison = 1;
    } else if (aStopSequence < bStopSequence) {
        comparison = -1;
    }

    return comparison;
}

// Used to determine where a route ID is inside of the route descriptions
function getRouteIndex(route, route_id) {
    let result = -1;
    for(let i in route) {
        if(route[i].route_id === route_id) {
            return i;
        }
    }
    return result;
}

// Used to determine where a stop ID is inside of the stops array
function getStationIndex(stops, stop_id) {
    let result = -1;
    for(let i in stops) {
        if(stops[i].stop_id === stop_id) {
            return i;
        }
    }
    return result;
}

// Call to PTV API to get all departures for a specific stop
// If a current searchTime has been specified, query the database for historical data.
async function getDeparturesForStop(stop_id, route_type, con) {
    var departures;
    //If no timestamp is specified in the .env file, live data is retrieved
    if(!searchTime){
        const request = '/v3/departures/route_type/' + route_type + '/stop/' + stop_id + '?look_backwards=false&max_results=1&devid=' + devID;
        const signature = encryptSignature(request);
        departures = await axios.get(baseURL + request + '&signature=' + signature)
        .then(response => {
            saveDepartureToDatabase(con,response.data.departures);
            return response.data.departures;
        })
        .catch(error => {
            console.log(error);
            return [];
        })
    } else{
        //Finds the closest timestamp to the one entered incase the timestamp is not exact.
        let timestamp = await getNearestTimestamp(searchTime);
        console.log ("searchtime is : " + searchTime);
        departures = await getDeparturesFromDatabase(con,stop_id,searchTime);
    }
    return departures;
}

// Returns the most recent timestamp to the one entered.
// does NOT return the closest timestamp if that timestamp is earlier than the given timestamp.
async function getNearestTimestamp(timestamp){
    console.log("searching with timestamp : " + timestamp)
    return new Promise((resolve, reject) =>{
        const query = `select * from departures where timestamp <= '${timestamp}' ORDER BY timestamp LIMIT 1;`
        con.query(query,function (err, result, fields){
            let closestTime = new Date(result[0].timestamp);
            resolve(convertDateTimeToDbFormat(closestTime));
        });
    })
}

// This function retrieves data from the database based on the entered search timestamp and stop_id.
async function getDeparturesFromDatabase(con,stop_id, timestamp){
    return new Promise((resolve, reject) => {
        const query = `select * from departures WHERE stopID = ${stop_id} AND timestamp = '${timestamp}'`;
        con.query(query, function (err, result, fields){
            if(err){
                reject(err);
                return;
            }
            let JSONTemplate = "[";
            //Formats the result into a JSON format so that it is readable by the middleware.
            for (i = 0; i < result.length -1; i++){
            if (i > 0){
                JSONTemplate += ","
            }
            JSONTemplate += `
            {
                "stop_id": ${result[i].stopID},
                "route_id": ${result[i].routeID},
                "run_id": ${result[i].runID},
                "direction_id" : ${result[i].directionID},
                "disruption_ids" : [],
                "scheduled_departure_utc" : "${convertDateTimeToApiFormat(result[i].scheduledDeparture)}",
                "estimated_departure_utc" : "${convertDateTimeToApiFormat(result[i].estimatedDeparture)}",
                "at_platform" : ${(result[i].atPlatform === 1 ? true : false)},
                "platform_number" : "${result[i].platformNumber}",
                "flags" : "",
                "departure_sequence" : ${result[i].departureSequence}
            }`
        }
        JSONTemplate += "]";
        if (JSONTemplate !== "["){
        JSONData = JSON.parse(JSONTemplate);
        }
            resolve(JSONData);
        });
    })
}

// Call to PTV API to get all departures for a specific run ID
async function getDeparturesForRun(run_id, route_type) {
    const request = '/v3/pattern/run/' + run_id + '/route_type/' + route_type + '?expand=stop&devid=' + devID;
    const signature = encryptSignature(request);
    var departures;
    departures = await axios.get(baseURL + request + '&signature=' + signature)
        .then(response => {
            // saveDepartureToDatabaseByRun(con,response.data.departures);
            // Above method is depreciated, has been left in comment for future developers.
            return response.data.departures;
        })
        .catch(error => {
            console.log(error);
            return [];
        })
    return departures;
}

//Creates the database schema if it does not currently exist in the database.
function initializeDatabase(con){
//Departures table for by stop
createTable(con,"CREATE TABLE IF NOT EXISTS departures (stopID int,routeID int, runID int, directionID int, scheduledDeparture datetime, estimatedDeparture datetime, atPlatform boolean, platformNumber int, departureSequence int, timestamp datetime)");
// Departures table by run - This table did not fully function on release, table SCHEMA has been left for future
// development groups.
// createTable(con,"CREATE TABLE IF NOT EXISTS departuresByRun (stopID int, routeID int, runID int, directionID int, scheduledDeparture datetime, estimatedDeparture datetime, atPlatform boolean, platformNumber varchar(255), departureSequence int, timestamp datetime)");
}

//saves a Departue to the database whenever an api call is made.
function saveDepartureToDatabase(con,data){
    for (i = 0; i <=data.length-1; i++){
    var sql = `INSERT INTO departures (stopID, routeID, runID, directionID, scheduledDeparture, estimatedDeparture, atPlatform, platformNumber, departureSequence, timestamp)
    VALUES (${data[i].stop_id}, ${data[i].route_id}, ${data[i].run_id}, ${data[i].direction_id}, ${removeFlagsFromDateTime(data[i].scheduled_departure_utc)}, ${removeFlagsFromDateTime(data[i].estimated_departure_utc)}, ${data[i].at_platform}, ${data[i].platform_number}, ${data[i].departure_sequence}, '${getCurrentDateTimeFromatted()}');`
        con.query(sql, function (err, result) {
          if (err) throw err;
        });
    }
}


//Converts time format from 'YYYY-MM-DDTHH:MM:SSZ' -> 'YYYY-MM-DD HH:MM:SS'
//Seconds are left as 00 to avoid too much variance in times when backtracking.
function removeFlagsFromDateTime(dateTime){
    if (dateTime === null){
        return "NULL";
    }
    let splitTime = dateTime.split("T");
    //drop Z flag from end of string and split on T flag
    let newDate = "'" + (splitTime[0] + " " + splitTime[1]).slice(0,-3) + "00'";
    return newDate;
}

// Converts a datetime object to the format YYYY-MM-DD HH-MM-SS
// Seconds left as 00 to avoid too much variance when retrieving data.
// getMonth/getDates by defualt return their values at M/D rather than MM/DD,
// To correct this formatting we add zero then slice so they are always in MM/DD format.
function convertDateTimeToDbFormat(timestamp){
    var datetime = timestamp.getFullYear() 
    + "-" + ("0"+timestamp.getMonth()).slice(-2) 
    + "-" + ("0"+timestamp.getDate()).slice(-2) + " " 
    + ("0" + timestamp.getHours()).slice(-2) + ":" 
    + ("0" + timestamp.getMinutes()).slice(-2) + ":" + ("00");
    return datetime;
}

//Formats dateTime object FROM the SQL database back to the PTV API format 'YYYY-MM-DDTHH:MM:SSZ'
function convertDateTimeToApiFormat(dateTime){
    let dateObj = new Date(dateTime)
    let formatedDate = `${dateObj.getFullYear()}-${("0"+dateObj.getMonth()).slice(-2)}-${("0"+dateObj.getDate()).slice(-2)}T${("0"+dateObj.getHours()).slice(-2)}:${("0"+dateObj.getMinutes()).slice(-2)}:00Z`
    return formatedDate;
}

//Function to create a table, takes in an sql Statement and handles errors to avoid code dupelication
function createTable(con, sql){
        con.query(sql, function (err, result) {
          if (err) throw err;
      });
}

module.exports = {
    // To check if the connection to the API is working
    healthCheck: async function () {
        const timestamp = moment.utc().format();
        const request = '/v2/healthcheck?timestamp=' + timestamp + '&devid=' + devID;
        const signature = encryptSignature(request);
        const result = await axios.get(baseURL + request + '&signature=' + signature)
            .then(response => {
                return response;
            })
            .catch(error => {
                console.log(error);
            })
        return result;
    },
    // Function to retrieve all the stops for a train line
    getStops: async function (route_id, route_type) {
        const request = '/v3/stops/route/' + route_id + '/route_type/' + route_type + '?direction_id=1&devid=' + devID;
        const signature = encryptSignature(request);

        const stops = await axios.get(baseURL + request + '&signature=' + signature)
            .then(response => {
                const stops = response.data.stops.sort(compareStops);
                return stops;
            })
            .catch(error => {
                console.log(error);
                return [];
            })
        return stops;
    },
    setCurrentTime(time){
        console.log("set current time: " + time);
        currentTime = false;
    },
    /**
     * Retrieve all the departures for stations and routes
     *
     * @param routes        Array containing info about route IDs
     * @param route_type    Route type number for use with PTV API (0 = Train, 1 = Tram)
     * @param uniqueStops   Iterable containing stops to check over
     */
    getDepartures: async function (routes, route_type, uniqueStops) {
        let routeDepartures = [];
        let stationDepartures = [];
        let counter = 0;

        // Set up array of departures for each route ID
        for(let i in routes) {
            routeDepartures.push({
                routeID: routes[i].route_id,
                currentDeparture: 0,
                departures: []
            })
        }

        for (let stop of uniqueStops.values()) {
            counter++;
            // Get all departures for a station
            let stopDepartures = {
                stop_id: stop.stop_id,
                stop_name: stop.stop_name,
                stop_latitude: stop.stop_latitude,
                stop_longitude: stop.stop_longitude,
                departures: await getDeparturesForStop(stop.stop_id, route_type, con)
                .then(response => {
                    return response;
                })
                .catch(error => {
                    console.log(error);
                    return [];
                })
            };
            console.log("(" + counter + "/" + uniqueStops.size +
                        ") Updating " + stopDepartures.stop_name +
                        " (ID = " + stopDepartures.stop_id +")");
            stationDepartures.push(stopDepartures);

            // Append departures from a station to associated route departure array

            for(let j in stopDepartures.departures) {
                if (stopDepartures.departures[j] !== null){
                let routeIndex = getRouteIndex(routes, stopDepartures.departures[j].route_id);
                if(routeIndex !== -1) {
                    routeDepartures[routeIndex].departures.push(stopDepartures.departures[j]);
                }
            }}
        }
        return {
            routeDepartures: routeDepartures,
            stationDepartures: stationDepartures
        };
    },
    // Retrieve all the departures for stations and routes
    getDeparturesForRunIDs: async function (runIDSet, route_type, uniqueStops) {
        let stationDepartures = [];
        let removeRunIDs = new Set();

        let runDepartures = [];
        let uniqueRunIDs = Array.from(runIDSet);

        // Set up array of departures for each route ID
        for(let stop of uniqueStops.values()) {
            stationDepartures.push({
                stop_id: stop.stop_id,
                stop_name: stop.stop_name,
                stop_latitude: stop.stop_latitude,
                stop_longitude: stop.stop_longitude,
                departures: []
            })
        }

        for (let i in uniqueRunIDs) {
            const run_id = uniqueRunIDs[i];

            // Get all departures for a station
            
            let departures = await getDeparturesForRun(run_id, route_type)
                .then(response => {
                    return response;
                })
                .catch(error => {
                    console.log(error);
                    return [];
                });

            if(departures != null) {
                let currentDeparture = -1;

                // Remove departures in the past
                for(let j in departures) {
                    let time;
                    if(departures[j].estimated_departure_utc != null) {
                        time = moment.utc(departures[j].estimated_departure_utc);
                    } else {
                        time = moment.utc(departures[j].scheduled_departure_utc);
                    }
                    if(time.diff(moment.utc(), 'minutes') >= 0) {
                        // validDepartures.push(departures[j]);
                        currentDeparture = j;
                        break;
                    }
                }

                // Only add runs if they have at least 1 valid departure
                if(currentDeparture >= 0) {
                    let runIDDepartures = {
                        run_id: run_id,
                        departures: departures,
                        currentDeparture: currentDeparture
                    };
                    console.log("(" + i + "/" + uniqueRunIDs.length +
                                ") Updating RunID " + run_id);
                    runDepartures.push(runIDDepartures);

                    // Append departures from a runID to associated station departure array
                    for(let j in runIDDepartures.departures) {
                        let stationIndex = getStationIndex(stationDepartures, runIDDepartures.departures[j].stop_id);
                        if(stationIndex !== -1 && j >= currentDeparture) {
                            stationDepartures[stationIndex].departures.push(runIDDepartures.departures[j]);
                        }
                    }
                } else {
                    removeRunIDs.add(run_id);
                }
            } else {
                removeRunIDs.add(run_id);
            }
        }

        return {
            runDepartures: runDepartures,
            stationDepartures: stationDepartures,
            removeRunIDs: removeRunIDs
        };
    },
    // Get routes for a given transportation type.
    getRoutes: async function (route_type) {
        const request = '/v3/routes?route_types=' + route_type + '&devid=' + devID;
        const signature = encryptSignature(request);
        const routes = await axios.get(baseURL + request + '&signature=' + signature)
            .then(response => {
                return response.data.routes;
            })
            .catch(error => {
                console.log(error);
                return [];
            })
        return routes;
    },
    // Get directions for a given route ID.
    getDirections: async function (route_id) {
        const request = '/v3/directions/route/' + route_id + '?devid=' + devID;
        const signature = encryptSignature(request);
        const directions = await axios.get(baseURL + request + '&signature=' + signature)
            .then(response => {
                return response.data.directions;
            })
            .catch(error => {
                console.log(error);
                return [];
            })
        return directions;
    },
    // Notify when a client calls this API
    notifyUpdate: function () {
        lastUpdate = new Date().getTime();
    },
    // Get the time of the last Client API call
    get lastUpdate() {
        return lastUpdate;
    }
};

/* This function has been left in for future developers of the project. It functions correctly
In the sense that it will correctly retrieve data from a database if needed, however for whatever reason the data is not
properly passed to the middleware correctly. Usually I would delete this code if I were to publish a project, however because
another capstone group will eventually use this code it has been left in. */

// async function getDeparturesFromDatabaseByRun(con,run_id){ 
//     return new Promise((resolve, reject) => {
//         const query = `select * from departuresByRun WHERE runID = ${run_id} AND timestamp = '2020-04-19 11:26:00'`;
//         con.query(query, function (err, result, fields){
//             if(err){
//                 reject(err);
//                 return;
//             }
//             let JSONTemplate = "[";
//             for (i = 0; i < result.length -1; i++){
//             if (i > 0){
//                 JSONTemplate += ","
//             }
//             JSONTemplate += `
//             {
//                 "stop_id": ${result[i].stopID},
//                 "route_id": ${result[i].routeID},
//                 "run_id": ${result[i].runID},
//                 "direction_id" : ${result[i].directionID},
//                 "disruption_ids" : [],
//                 "scheduled_departure_utc" : "${convertDateTimeToApiFormat(result[i].scheduledDeparture)}",
//                 "estimated_departure_utc" : "${convertDateTimeToApiFormat(result[i].estimatedDeparture)}",
//                 "at_platform" : ${(result[i].atPlatform === 1 ? true : false)},
//                 "platform_number" : "${result[i].platformNumber}",
//                 "flags" : "",
//                 "departure_sequence" : ${result[i].departureSequence}
//             }`
//         }
//         JSONTemplate += "]";
//         if (JSONTemplate !== "["){
//         JSONData = JSON.parse(JSONTemplate);
//         }
//             resolve(JSONData);
//         });
//     })
// }

/*Saves a departure to database whenever an pi call is me for departures by run.
 This function is also not in use as the middleware would not read the data correctly.
 I have left the code here for future development goups. */
// function saveDepartureToDatabaseByRun(con, data){
//     for (i = 0; i <=data.length-1; i++){
//         var sql = `INSERT INTO departuresByRun (stopID, routeID, runID, directionID, scheduledDeparture, estimatedDeparture, atPlatform, platformNumber, departureSequence, timestamp)
//         VALUES (${data[i].stop_id}, ${data[i].route_id}, ${data[i].run_id}, ${data[i].direction_id}, ${removeFlagsFromDateTime(data[i].scheduled_departure_utc)}, ${removeFlagsFromDateTime(data[i].estimated_departure_utc)}, ${data[i].at_platform}, '${data[i].platform_number}', ${data[i].departure_sequence}, '${getCurrentDateTimeFromatted()}');`
//             con.query(sql, function (err, result) {
//               if (err) throw err;
//             });
//         }
// }