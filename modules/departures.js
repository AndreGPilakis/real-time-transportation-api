const moment = require('moment');

// Function to sort array according to the estimated_departure_time
function compareDeparturesTime(a, b) {
    let aTime, bTime;
    if (a.estimated_departure_utc) {
        aTime = moment.utc(a.estimated_departure_utc);
    }
    else {
        aTime = moment.utc(a.scheduled_departure_utc);
    }

    if (b.estimated_departure_utc) {
        bTime = moment.utc(b.estimated_departure_utc);
    }
    else {
        bTime = moment.utc(b.scheduled_departure_utc);
    }

    let comparison = 0;
    if (aTime.isAfter(bTime)) {
        comparison = 1;
    } else if (aTime.isBefore(bTime)) {
        comparison = -1;
    }

    return comparison;
}

module.exports = {
    // Obtaining the unique run ids from departures
    getUniqueRuns: function (departures, uniqueRunIDs) {
        let runIDs = new Set();

        for (let i in departures) {
            runIDs.add(departures[i].run_id);
        }

        return Array.from(runIDs);
    },
    // Retrieving the departures for each unique runs to create a dictionary of run -> list of departures
    getDeparturesForRuns: function (runIDSet, departures) {
        let filteredRuns = [];
        let uniqueRunIDs = Array.from(runIDSet);

        for (let i in uniqueRunIDs) {
            let runID = uniqueRunIDs[i];
            let runIDDepartures = [];
            let direction_id;

            // Get all departures for a given runID
            for (let j in departures) {
                if (departures[j].run_id === runID) {
                    runIDDepartures.push(departures[j]);

                    if (!direction_id) {
                        direction_id = departures[j].direction_id;
                    }
                }
            }

            // Store the array of departures for a runID
            if (runIDDepartures.length > 0) {
                runIDDepartures.sort(compareDeparturesTime);

                filteredRuns.push({
                    run_id: runID,
                    currentDeparture: 0,
                    departures: runIDDepartures
                });
            }
        }

        return filteredRuns;
    },
    // Determine the coordinates of a train in between stations
    determineRunCoordinates: function (scalar, previousStopCoordinates, nextStopCoordinates) {
        const xCoordinate = (scalar * previousStopCoordinates[0]) + ((1 - scalar) * nextStopCoordinates[0]);
        const yCoordinate = (scalar * previousStopCoordinates[1]) + ((1 - scalar) * nextStopCoordinates[1]);

        console.log("Train is at : " + xCoordinate + "," + yCoordinate);
        return [xCoordinate, yCoordinate];
    },

}