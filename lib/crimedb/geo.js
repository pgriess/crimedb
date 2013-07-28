/*
 * Geocoding utilities for CrimeDB.
 */

var assert = require('assert');
var child_process = require('child_process');

/**
 * Convert a string like "90d16'31.436"W" to a number. Raises an exception on
 * error.
 */
var degreeStringToNum = function(degreeString) {
    var arr = /^(\d+)d(\d+)'([\d\.]+)"([NESW])$/.exec(degreeString);
    if (!arr) {
        throw Error('Degree string \'' + degreeString + '\' is malformed');
    }

    var val = parseInt(arr[1]) +
              parseInt(arr[2]) / 60 +
              parseInt(arr[3]) / 3600;
    if (arr[4] == 'W' || arr[4] == 'S') {
        val *= -1;
    }

    return val;
};

/*
 * Convert a location in SPSC coordinates to a GeoJSON object.
 *
 * Inputs are an SPSC[1] zone number and x, and y coordinates, and the units of
 * the x and y coordinates. This function requires cs2cs[2] to be installed and
 * in the program's PATH. List of supported units can be found by running
 * 'cs2cs -lu'.
 *
 * References:
 *
 *      [1] http://en.wikipedia.org/wiki/State_Plane_Coordinate_System 
 *      [2] http://trac.osgeo.org/proj/
 *
 * TODO: Create V8 bindings for the Proj library and use them instead. Or open
 *       a single subprcess and leave stdout/stdin open to pipe stuff to/from.
 *       Spawning a process per resolution is kind of awful, especially since
 *       we suck at it.
 */
var spcsToLatLong = function() {
    var MAX_ACTIVE_WORKERS = 10;
    var numActiveWorkers = 0;
    var waiters = [];

    var runWorker = function(zone, x, y, units, callback) {
        var cs2csOutput = '';

        assert.ok(numActiveWorkers < MAX_ACTIVE_WORKERS);
        ++numActiveWorkers;

        child_process.exec(
            'echo "' + x + ' ' + y + '" | ' +
            'cs2cs +init=nad83:' + zone + ' +units=' + units,
            function(err, stdout, stdin) {
                --numActiveWorkers;

                if (err) {
                    callback(err, null);
                } else {
                    stdout = stdout.trim();
                    try {
                        var coords = stdout.toString('ascii').split(/\s+/);
                        var lon = degreeStringToNum(coords[0]);
                        var lat = degreeStringToNum(coords[1]);

                        /* GeoJSON specifies [lon, lat] ordering */
                        callback(
                            null,
                            {type: 'Point', coordinates: [lon, lat]});
                    } catch (e) {
                        callback(e, null);
                    }
                }

                if (waiters.length == 0) {
                    return;
                }

                var w = waiters.shift();
                runWorker(w.zone, w.x, w.y, w.units, w.callback);
            }
        );
    };

    return function(zone, x, y, units, callback) {
        if (waiters.length > 0 || numActiveWorkers >= MAX_ACTIVE_WORKERS) {
            waiters.push(
                {zone: zone, x: x, y: y, units: units, callback: callback});
            return;
        }

        runWorker(zone, x, y, units, callback);
    };
}();
exports.spcsToLatLong = spcsToLatLong;
