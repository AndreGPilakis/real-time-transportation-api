const axios = require('axios');
const crypto = require('crypto');
const moment = require('moment');
var mysql = require('mysql');


const baseURL = 'https://timetableapi.ptv.vic.gov.au';
const apiKey = process.env.API_KEY;
const devID = process.env.DEV_ID;

//Connecting to db
//@TODO Change user/pass
//@TODO Move SQL to new place?
var con = mysql.createConnection({
    host: "localhost",
    user: "andre",
    password: "ptv123",
    database: "ptv"
  });

initializeDatabase(con);

// Time of last Client API call (Date().getTime())
let lastUpdate;

// Generate signature for the API request
function encryptSignature(url) {
    return crypto.createHmac('sha1', apiKey).update(url).digest('hex');
}

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
async function getDeparturesForStop(stop_id, route_type, con) {
    const request = '/v3/departures/route_type/' + route_type + '/stop/' + stop_id + '?look_backwards=false&max_results=1&devid=' + devID;
    const signature = encryptSignature(request);

    var currentTime = false;
    var departures;

    if(currentTime){
    departures = await axios.get(baseURL + request + '&signature=' + signature)
        .then(response => {
            console.log(response.data.departures);
            saveDepartureToDatabase(con,response.data.departures);
            return response.data.departures;
        })
        .catch(error => {
            console.log(error);
            return [];
        })
    } else{
        console.log("---start---");
        con.query("Select * from departures WHERE stopID = 1222 AND timestamp = '2020-04-05 06:35:00'", function (err, result, fields) {
            if (err) throw err;
            //adds each row from the query to a JSON object
            var myJSON = []
            for (i = 0; i < result.length -1; i++){
                let formattedQuery = 
                `stop_id : ${result[i].stopID}`
                myJSON.push(formattedQuery);
            }
            console.log(myJSON);
            // var myJSON = [];
            // var obj1 = {
            //     "var134242342343242342" : "val12342424243234234"
            // }

            // var obj2 = {
            //     "var223424234234234234" : "val234242342342"
            // }
            // myJSON.push(obj1);
            // myJSON.push(obj2);
            // console.log(myJSON);

            // console.log(result[0]);
            console.log("---end---");
          });
    }
    return departures;
}

// Call to PTV API to get all departures for a specific run ID
async function getDeparturesForRun(run_id, route_type) {
    const request = '/v3/pattern/run/' + run_id + '/route_type/' + route_type + '?expand=stop&devid=' + devID;
    const signature = encryptSignature(request);

    const departures = await axios.get(baseURL + request + '&signature=' + signature)
        .then(response => {
            console.log("Departures for run");
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
}

//saves a Departue to the database whenever an api call is made.
function saveDepartureToDatabase(con,data){
    for (i = 0; i <=data.length-1; i++){
    var sql = `INSERT INTO departures (stopID, routeID, runID, directionID, scheduledDeparture, estimatedDeparture, atPlatform, platformNumber, departureSequence, timestamp)
    VALUES (${data[i].stop_id}, ${data[i].route_id}, ${data[i].run_id}, ${data[i].direction_id}, ${convertToDateTime(data[i].scheduled_departure_utc)}, ${convertToDateTime(data[i].estimated_departure_utc)}, ${data[i].at_platform}, ${data[i].platform_number}, ${data[i].departure_sequence}, '${getCurrentDateTimeFromatted()}');`
        con.query(sql, function (err, result) {
          if (err) throw err;
        });
    }
}

//Converts the given date time to a format the SQL database will accept. Quotes needed to be added for NULL values.
function convertToDateTime(dateTime){
    if (dateTime === null){
        return "NULL";
    }
    let splitTime = dateTime.split("T");
    //drop Z flag from end of string and split on T flag
    let newDate = "'" + (splitTime[0] + " " + splitTime[1]).slice(0,-3) + "00'";
    return newDate;
}

//returns the current dateTime in a format for the SQL database
function getCurrentDateTimeFromatted(){
    var currentdate = new Date();
    var datetime = currentdate.getFullYear() + "-" + currentdate.getMonth() 
    + "-" + currentdate.getDay() + " " 
    + ("0" + currentdate.getHours()).slice(-2) + ":" 
    + ("0" + currentdate.getMinutes()).slice(-2) + ":" + ("00");
    return datetime;
}

//Function to create a table, takes in an sql Statement and handles errors to avoid code dupelication
function createTable(con, sql){
    con.connect(function(err) {
        if (err) throw err;
        console.log("Attempting to execute " + sql);
        con.query(sql, function (err, result) {
          if (err) throw err;
          console.log("Table created");
        });
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
                let routeIndex = getRouteIndex(routes, stopDepartures.departures[j].route_id);
                if(routeIndex !== -1) {
                    routeDepartures[routeIndex].departures.push(stopDepartures.departures[j]);
                }
            }
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
                                ") Updating RunIDasdasdasdsd " + run_id);
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

