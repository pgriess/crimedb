/*
 * Web application for CrimeDB.
 */

var console = require('console');
var hapi = require('hapi');
var request = require('request');
var strptime = require('micro-strptime').strptime;

var api_handler = function(req) {
    var FIELD_TRANSFORMATIONS = {
        date: ['time', function(v) {
            return strptime(v, '%Y-%m-%dT%H:%M:%S%Z').getTime() / 1000;
        }],
        description: ['description', function(v) { return v; }],
    };

    /*
     * Apply query parameters from the request
     *
     * XXX: Parameter validation, including types and ranges. Hapi can
     *      do this sort of thing, AFAICT.
     */
    var solrQuery = {};
    solrQuery.q = '*:*';
    solrQuery.limit = Math.min(req.query.limit || 100, 1000);

    request({
        url: 'http://localhost:8080/solr-4.3.0/crime/query',
        qs: solrQuery,
        json: [],
        headers: {'Accept': 'application/json'}},
        function(err, resp, body) {
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

            /*
             * TODO: Handle Solr errors here. There may be some in the response
             *       format.
             * TODO: Cursors.
             */
            var outDocs = body.response.docs.map(function(inDoc) {
                var outDoc = {};
                for (k in inDoc) {
                    if (!(k in FIELD_TRANSFORMATIONS)) {
                        continue;
                    }

                    ft = FIELD_TRANSFORMATIONS[k];
                    outDoc[ft[0]] = ft[1](inDoc[k]);
                }

                return outDoc;
            });


            req.reply(JSON.stringify({results: outDocs}))
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
