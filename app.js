// Load environment variables
require('dotenv').config();

const axios = require('axios');
const crypto = require('crypto');
const moment = require('moment');

const baseURL = 'https://timetableapi.ptv.vic.gov.au';
const apiKey = process.env.API_KEY;
const devID = process.env.DEV_ID;

const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');

// Self-defined modules
const API = require('./modules/PTVapi');
const Stations = require('./modules/stations');
const Departures = require('./modules/departures');

const app = express();

// Transport type to lookup
// 0 = Train, 1 = Tram
let ROUTE_TYPE = 0;
let toggleRouteType = false;

// Prevent simultaneous repetitions
let repetitionReady = false;

// Unused station stop IDs
const FLEMINGTON_RC = 1070;

let routes = [];
let terminalStops = new Map();
let uniqueStops = new Map();
let uniqueRunIDs = new Set();
let refresh;

const SECONDS_TO_MS = 1000;

// Set default PTV API call frequency (30 seconds)
let ptvAPIRepFreq = 30 * SECONDS_TO_MS;

// Set default demand threshold since last client connected (60 seconds)
let apiDemandThreshold = 60 * SECONDS_TO_MS;

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

/**
 * Initially populate the maps data structures
 *
 * @returns {Promise<void>} Not currently used
 */
async function initiate() {
  console.time("initiate");
  repetitionReady = false;
  // Get all routes for a given route type (Train/Tram)
  await API.getRoutes(ROUTE_TYPE)
      .then(result => {
        routes = result; // Save the routes in the instance variable
        let stops = [];

        // For each route, get the stops and directions
        for (let route in routes) {
          const route_id = routes[route].route_id;
          console.log("ROUTE ID = " + route_id + " (" + routes[route].route_name + ")");
          getDirectionsForRoute(route, route_id);
          getStopsForRoute(route_id, stops);
        }
      });
};

/**
 * Get directions for a given route
 *
 * @param route       Route data from the API
 * @param route_id    Associated id of @param route
 */
async function getDirectionsForRoute(route, route_id) {
  API.getDirections(route_id)
      .then(directions => {
        routes[route].directions = directions;
        console.log("Route ID " + route_id + " directions:");
        for (let direction in routes[route].directions) {
          console.log("\t ID: " + directions[direction].direction_id + " = " + directions[direction].direction_name);
        }
      });
}

/**
 * Get the stops for a given route
 *
 * @param route_id      id of the route to get stops for
 * @param stops         collection of stops to get departures for
 * @param uniqueStops   collection of unique stops
 */
async function getStopsForRoute(route_id, stops) {
  API.getStops(route_id, ROUTE_TYPE)
      .then(routeStops => {
        let index; // Index of unused station

        // For each stop in a route
        for (let stop in routeStops) {
          let stopID = routeStops[stop].stop_id;
          // Detect unused stations
          if (stopID === FLEMINGTON_RC) {
            index = stop;
          } else {
            // Keep track of unique stops
            uniqueStops.set(stopID, {
              stop_id: stopID,
              stop_name: routeStops[stop].stop_name,
              stop_latitude: routeStops[stop].stop_latitude,
              stop_longitude: routeStops[stop].stop_longitude
            });
          }
        } // end of for each loop

        // Remove unused stations
        if (index) {
          routeStops.splice(index, 1);
        }

        // Build stops collection
        stops.push({
          routeID: route_id,
          routeStops: routeStops
        });

        terminalStops.set(routeStops[0].stop_id, {
          stop_id: routeStops[0].stop_id,
          stop_name: routeStops[0].stop_name,
          stop_latitude: routeStops[0].stop_latitude,
          stop_longitude: routeStops[0].stop_longitude
        });
        terminalStops.set(routeStops[routeStops.length - 1].stop_id, {
          stop_id: routeStops[routeStops.length - 1].stop_id,
          stop_name: routeStops[routeStops.length - 1].stop_name,
          stop_latitude: routeStops[routeStops.length - 1].stop_latitude,
          stop_longitude: routeStops[routeStops.length - 1].stop_longitude
        });

        // Get all departures for each unique stop when all stops are retrieved
        if (stops.length === routes.length) {
          // Store route descriptions
          app.locals.routeStops = stops;
          app.locals.routes = routes;
          getDeparturesForStops(stops);
        }
      })
}

/**
 * Get the departures for all unique stops (uniqueStops)
 *
 * @param stops           collection of stops in a route
 */
async function getDeparturesForStops(stops) {
  await API.getDepartures(routes, ROUTE_TYPE, uniqueStops)
      .then(response => {
        let routeDepartures = response.routeDepartures;
        let stationDepartures = response.stationDepartures;

        let filteredRuns;
        let runs = [];

        app.locals.stationDepartures = stationDepartures;

        // Get departures for every unique runID
        for (let k in routeDepartures) {
          const routeID = routeDepartures[k].routeID;

          for (let i in routeDepartures[k].departures) {
              uniqueRunIDs.add(routeDepartures[k].departures[i].run_id);
          }
          filteredRuns = Departures.getDeparturesForRuns(uniqueRunIDs, routeDepartures[k].departures);
          getValidRuns(runs, filteredRuns, stops);
        }
        app.locals.data = {
          runs: runs
        };

        console.log("Initialised: " + app.locals.data.runs.length + " runs.");
        console.timeEnd("initiate");
        repetitionReady = true;
      })
}

/**
 * Get the departures for all run IDs (uniqueRunIDs)
 *
 * @param stops           collection of stops in a route
 */
async function getDeparturesForRunIDs() {
  let removeRunIDs;
  await API.getDeparturesForRunIDs(uniqueRunIDs, ROUTE_TYPE, uniqueStops)
    .then(response => {
      app.locals.stationDepartures = response.stationDepartures;
      let filteredRuns = response.runDepartures;
      let stops = app.locals.routeStops;
      let runs = [];
      removeRunIDs = response.removeRunIDs;

      // Remove runIDs that no longer have any present departures
      console.log("Removing " + removeRunIDs.size + " RunIDs:");
      for(let oldRunID of removeRunIDs) {
        console.log("\t" + oldRunID);
        uniqueRunIDs.delete(oldRunID);
      }

      getValidRuns(runs, filteredRuns, stops);

      app.locals.data = {
        runs: runs
      };

      console.log("Updated: " + app.locals.data.runs.length + " runs.");
    })
  await getNewRunIDs(removeRunIDs);
  console.timeEnd("repetition");
  repetitionReady = true;
}

/**
 * Checks to ensure stops in runs coincide with route stops
 * Also determines coordinates of vehicle for each run
 *
 * @param runs           Array to output valid runs into
 * @param filteredRuns   Runs to validate
 * @param stops          Stops for each route to check against
 */
function getValidRuns(runs, filteredRuns, stops) {
  for (let i in filteredRuns) {
    // Get array of departures for route ID of run
    let routeIDStops;
    for (let j in stops) {
      if (stops[j].routeID === filteredRuns[i].departures[0].route_id) {
        routeIDStops = stops[j].routeStops;
        break;
      }
    }

    let target = new Set();
    let valid = 0;

    // Determine all stopIDs covered by all of a given runID departures
    for (let j in filteredRuns[i].departures) {
      target.add(filteredRuns[i].departures[j].stop_id);
    }

    // Determine if any of the runID stops match up with routeID Stops
    for (let j in routeIDStops) {
      if (target.has(routeIDStops[j].stop_id)) {
        valid++;
      }
    }

    // Require that runID stops are entirely in routeID stops
    if (valid === target.size) {
      runs.push({
        departure: filteredRuns[i].departures,
        currentDeparture: filteredRuns[i].currentDeparture,
        coordinates: Stations.getCoordinatesPair(routeIDStops, uniqueStops, filteredRuns[i])
      });
    } else {
      console.log("Invalid size");
    }
  }
}

/**
 * Checks terminal stations for any new runIDs that appear over time

 * @param oldRunIDs        Used to not add in stops that have just been removed
 */
async function getNewRunIDs(oldRunIDs) {
  await API.getDepartures(routes, ROUTE_TYPE, terminalStops)
    .then(response => {
      let stationDepartures = response.stationDepartures;

      let addedRunIDs = new Set(); // This is only for logging purposes

      for(let i in stationDepartures) {
        let departures = stationDepartures[i].departures;
        for(let j in departures) {
          if(!uniqueRunIDs.has(departures[j].run_id) && !oldRunIDs.has(departures[j].run_id)) {
            addedRunIDs.add(departures[j].run_id);
            uniqueRunIDs.add(departures[j].run_id);
          }
        }
      }

      console.log("Adding " + addedRunIDs.size + " RunIDs:")
      for(let i of addedRunIDs.values()) {
        console.log("\t" + i);
      }
    })
}

/**
 * Runs every ptvAPIRepFreq milliseconds to update the departures
 *
 * @returns {Promise<void>}   Not used
 */
async function repetition() {
  // Return if there are no recent requests clients
  if (!API.lastUpdate || new Date().getTime() - API.lastUpdate > apiDemandThreshold) return console.log("--No clients connected--");
  // Return if a repetition is already running
  if (!repetitionReady) return console.log("Repetition is already running");
  repetitionReady = false;

  await checkRouteTypeToggleRequest();
  await getDeparturesForRunIDs();
};

// Check for a requested change in route type
async function checkRouteTypeToggleRequest() {
  if (toggleRouteType) {
    console.log("Reinitialising with new route type");
    toggleRouteType = false;
    ROUTE_TYPE = 1 - ROUTE_TYPE; // Toggle Route Type

    // Clear the existing data
    app.locals.routeStops = [];
    app.locals.stationDepartures = [];

    routes = [];
    terminalStops = new Map();
    uniqueStops = new Map();
    uniqueRunIDs = new Set();

    clearInterval(refresh);
    await initiate();
    refresh = setInterval(repetition, apiDemandThreshold); // TODO: SET THE CORRECT API THRESHOLD
  }
}

initiate();
refresh = setInterval(repetition, ptvAPIRepFreq);

// TODO: Cleanup
// Cyclic dependency with index.js, module.exports must be called before requiring index.js.
// Possibly move route type into PTVapi.js instead.
module.exports = {
  app,
  // Notify that the route type should be toggled at the end of the repetition
  notifyToggleRouteType: function () {
    toggleRouteType = true;
  }
};

// Router to handle requests
const indexRouter = require('./routes/index');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));


// Forward other requests to router
app.use('/', indexRouter);
app.use('/api', indexRouter);

// Handle requests to update refresh rate
app.use('/refresh', function (req, res, next) {
  if(refresh != null) {
    if(req.body.refreshRate != null) {
      let refreshRate = req.body.refreshRate;

      res.send("Updating refresh rate to: " + refreshRate + " seconds");
      console.log("Updating refresh rate to: " + refreshRate + " seconds");

      // Reset refresh timer with new rate
      API.notifyUpdate();
      clearInterval(refresh);
      ptvAPIRepFreq = refreshRate * SECONDS_TO_MS;
      refresh = setInterval(repetition, ptvAPIRepFreq);

      apiDemandThreshold = 2 * ptvAPIRepFreq;
    } else {
      // Return current refresh rate
      res.json({refresh: ptvAPIRepFreq / SECONDS_TO_MS});
    }
  } else {
    res.send("Wait for initialisation to finish...");
  }
});

//Displaying disruptions
app.use('/disruptions', function (req, res, next) {
  getDelaysForRoute(req.query.ID,res);
});

//Getting nearby MyKi Readers
app.use('/mykireaders', function (req, res, next){
  getMyKiReaders(req.query.latitude, req.query.longitude, res);
});

app.use('/rewindTime', function (req, res, next){
  rewindTime(res);
});


//encrypts a signature
function encryptSignature(url) {
  return crypto.createHmac('sha1', apiKey).update(url).digest('hex');
}

async function rewindTime(res){
  console.log("Inside asyn in app.ks");
  API.setCurrentTime("placeholder");
  res.send("res send");
  return("return from app.js");
}

//@TODO move to PTVapi.js
async function getMyKiReaders(latitude,longitude,res){
  //distance in meters that will be searched
  const max_distance = 1000;
  //amount of stations to show
  const max_results = 5;
  const request =`/v3/outlets/location/${latitude},${longitude}?max_distance=${max_distance}&max_results=${max_results}&devid=${devID}`;
  const signature = encryptSignature(request);

  const mykiStations = await axios.get(baseURL + request + '&signature=' + signature)
  .then(response => {
    console.log(response.data.outlets);
    res.send(response.data.outlets);
    return response.data.outlets;
})
.catch(error => {
    console.log(error);
    return [];
})
return mykiStations
}

//@TODO Move to PTVapi.js
//gets delays for a route
async function getDelaysForRoute(route_id, res){
  const request = `/v3/disruptions/route/${route_id}?devid=${devID}`;
  const signature = encryptSignature(request);

  console.log("looking for route with id : " + route_id);

  const delays = await axios.get(baseURL + request + '&signature=' + signature)
      .then(response => {
          console.log("Found stop with name : " + response.data.disruptions.metro_train[0].routes[0].route_name);
          console.log(response.data.disruptions);
          res.send(response.data.disruptions);
          return response.data.disruptions;
      })
      .catch(error => {
          console.log("catching error");
          console.log(error);
          return [];
      })
  return delays
}



// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});
