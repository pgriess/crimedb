/*
 * Web application for CrimeDB.
 */

var console = require('console');
var crimedb_common = require('crimedb/common');
var hapi = require('hapi');

crimedb_common.getDB(
    'http://localhost:5984/crimes', false, false,
    function(err, dbHandle) {
        if (err) {
            throw err;
        }

        var api_handler = function(req) {
            /* Default query parameters */
            var couchQuery = {
                limit: 100
            };

            /*
             * Apply query parameters from the request
             *
             * XXX: Parameter validation, including types and ranges. Hapi can
             *      do this sort of thing, AFAICT.
             */
            couchQuery.limit = req.query.limit || 100;

            dbHandle.request({
                    path: '/_design/foo/_view/bar',
                    query: couchQuery,
                }, function(err, result) {
                    if (err) {
                        // XXX: Generate an absolute URI for the current
                        //      hostname. Write handler for each of these pages
                        //      so that they're actually useful.
                        req.reply(
                            JSON.stringify({
                                title: 'Internal error',
                                problemType: 'http://localhost:8888/errors/Internal_error'}))
                            .code(500)
                            .type('application/api-problem+json');
                        return;
                    }

                    req.reply(JSON.stringify({results: result.rows}))
                        .code(200)
                        .type('application/vnd.crimedb.org+json')
                }
            );
        };

        var server = hapi.createServer('localhost', 8888, {cors: true})
        server.route([{
                path: '/crimes',
                method: 'GET',
                handler: api_handler,
        }]);
        server.start();
    }
);
