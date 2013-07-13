/*
 * Web application for CrimeDB.
 */

var console = require('console');
var crimedb_common = require('crimedb/common.js');
var hapi = require('hapi');
var request = require('request');
var strptime = require('micro-strptime').strptime;

/*
 * Map Solr fields to our public API
 */
var transformSolrDocument = (function() {
    /*
     * Each property of this object describes how a Solr field of that name is
     * mapped in to the output document. Fields not listed here are stripped
     * from Solr output.
     */
    var FIELD_TRANSFORMATIONS = {
        date: ['time', function(v) {
            return strptime(v, '%Y-%m-%dT%H:%M:%S%Z').getTime() / 1000;
        }],
        description: ['description', null],
        location: ['location', function(v) {
            return {type: 'Point', coordinates: v.split(',')};
        }],
    };

    return function(inDoc) {
        var outDoc = {};
        for (k in inDoc) {
            if (!(k in FIELD_TRANSFORMATIONS)) {
                continue;
            }

            ft = FIELD_TRANSFORMATIONS[k];
            outDoc[ft[0]] = (ft[1]) ? ft[1](inDoc[k]) : inDoc[k];
        }

        return outDoc;
    };
})();

var api_handler = function(req) {

    /*
     * Apply query parameters from the request
     *
     * XXX: Parameter validation, including types and ranges. Hapi can
     *      do this sort of thing, AFAICT.
     */
    var solrQuery = {
        limit: 100
    };

    if ('limit' in req.query) {
        solrQuery.limit = Math.min(req.query.limit, 1000);
    }

    if ('time' in req.query) {
        var arr = /^\[(\d+):(\d+)\]$/.exec(req.query.time);
        if (!arr) {
            req.reply(
                JSON.stringify({
                    title: 'Invalid query parameter',
                    problemType: 'http://localhost:8888/errors/Invalid_query_parameter'}))
                .code(500)
                .type('application/api-problem+json');
            return;
        }

        var from = new Date(arr[1] * 1000);
        var to = new Date(arr[2] * 1000);
        var clause = '+date:[' +
            crimedb_common.formatDateForSolr(from) + ' TO ' +
            crimedb_common.formatDateForSolr(to) + ']';

        solrQuery.q = ('q' in solrQuery) ?
            (solrQuery.q + ' ' + clause) :
            clause;
    }

    if ('location' in req.query) {
        var arr = /^\[(-?[\d\.]+)\s*,\s*(-?[\d\.]+):(-?[\d\.]+)\s*,\s*(-?[\d\.]+)\]$/.exec(req.query.location);
        if (!arr) {
            req.reply(
                JSON.stringify({
                    title: 'Invalid query parameter',
                    problemType: 'http://localhost:8888/errors/Invalid_query_parameter'}))
                .code(500)
                .type('application/api-problem+json');
            return;
        }

        var lat1 = parseFloat(arr[1]);
        var lon1 = parseFloat(arr[2]);
        var lat2 = parseFloat(arr[3]);
        var lon2 = parseFloat(arr[4]);
        var clause = '+location:[' +
            lat1 + ',' + lon1 + ' TO ' +
            lat2 + ',' + lon2 + ']';

        solrQuery.q = ('q' in solrQuery) ?
            (solrQuery.q + ' ' + clause) :
            clause;
    }

    if ('description' in req.query) {
        var clause = '+description:' + req.query.description;
        solrQuery.q = ('q' in solrQuery) ?
            (solrQuery.q + ' ' + clause) :
            clause;
    }

    /*
     * Set our default query last so that we give the filters a chance to be
     * added earlier.
     */
    if (!('q' in solrQuery)) {
        solrQuery.q = '*:*';
    }

    request({
        url: 'http://localhost:8080/solr-4.3.0/crime/query',
        qs: solrQuery,
        json: [],
        headers: {'Accept': 'application/json'}},
        function(err, resp, body) {
            if (err || 'error' in body) {
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
             * TODO: Cursors.
             */
            req.reply(JSON.stringify({
                    results: body.response.docs.map(transformSolrDocument)}))
                .code(200)
                .type('application/vnd.crimedb.org+json')
        }
    );
};

var server = hapi.createServer('0.0.0.0', 8888, {cors: true})
server.route([{
        path: '/crimes',
        method: 'GET',
        handler: api_handler,
}]);
server.start();
