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
            coords = v.split(',');

            return {
                type: 'Point',
                coordinates: [coords[1], coords[0]]
            };
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

var api_handler = function(req, reply) {

    /* Fail the request with our JSON formatting */
    var failRequest = function(title, problemType) {
        reply(
            JSON.stringify({
                title: title,
                problemType: 'http://' + req.info.host + '/errors/' +
                    problemType}))
            .code(500)
            .type('application/api-problem+json');
    }

    /*
     * Apply query parameters from the request
     *
     * XXX: Parameter validation, including types and ranges. Hapi can
     *      do this sort of thing, AFAICT.
     */
    var solrQuery = {
        rows: 100
    };

    if ('limit' in req.query) {
        solrQuery.rows = Math.min(req.query.limit, 1000000);
    }

    if ('time' in req.query) {
        var arr = /^\[(\d+):(\d+)\]$/.exec(req.query.time);
        if (!arr) {
            failRequest('Invalid query parameter', 'InternalError');
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
            failRequest('Invalid query parameter', 'InternalError');
            return;
        }

        var lat1 = parseFloat(arr[1]);
        var lon1 = parseFloat(arr[2]);
        var lat2 = parseFloat(arr[3]);
        var lon2 = parseFloat(arr[4]);
        var clause = '+location:[' +
            Math.min(lat1,lat2) + ',' + Math.min(lon1,lon2) + ' TO ' +
            Math.max(lat1,lat2) + ',' + Math.max(lon1,lon2) + ']';

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
                failRequest('Error talking to data store', 'InternalError');
                return;
            }

            /*
             * TODO: Cursors.
             */
            reply(JSON.stringify({
                    results: body.response.docs.map(transformSolrDocument)}))
                .code(200)
                .type('application/vnd.crimedb.org+json')
        }
    );
};

var server = hapi.createServer('0.0.0.0', 8888, {
    cors: true,
    files: { relativeTo: '.' },
});
server.route([
    {
        path: '/crimes',
        method: 'GET',
        handler: api_handler,
    }, {
        path: '/errors/{error}',
        method: 'GET',
        handler: {
            file: function(req) {
                return 'static/errors/' + req.params.error + '.html';
            }
        }
    }, {
        path: '/viz',
        method: 'GET',
        handler: { file: 'static/viz.html' },
    }, {
        path: '/',
        method: 'GET',
        handler: { file: 'static/index.html' },
    }
]);
server.pack.require(
    'good',
    {
        subscribers: { console: ['request', 'log', 'ops'] },
        extendedRequests: true,
    },
    function(err) {
        if (err) {
            throw err;
        }
    }
);
server.start();
