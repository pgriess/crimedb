/*
 * Web application for CrimeDB.
 */

var assert = require('assert');
var console = require('console');
var crimedb_common = require('crimedb/common.js');
var fs = require('fs');
var hapi = require('hapi');
var mustache = require('mustache');
var osm = require('crimedb/osm');
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
            coords = v.split(/[, ]/);

            return {
                type: 'Point',
                coordinates: [coords[0], coords[1]]
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

    /* TODO: Use XML response format so that we can stream the
     *       response back rather than reading the entire thing?
     *       Requires manually generating JSON.
     */
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

var osm_view_handler = function(req, reply) {
    assert('relation_id' in req.payload);
    var relationID = req.payload.relation_id;

    /* Pull out the list of nodes, ways and relations */
    op = new osm.Parser();

    var nodes = [];
    op.on('node', function(n) {
        nodes.push(n);
    });

    var ways = [];
    op.on('way', function(w) {
        ways.push(w);
    });

    var relations = [];
    op.on('relation', function(r) {
        relations.push(r);
    });

    op.on('end', function() {
        /* Turn the relation into an ordered list of nodes */
        var mapFromArray = function(a) {
            var m = {};
            a.forEach(function(o) {
                m[o.attributes.id] = o;
            });

            return m;
        };

        var nodeMap = mapFromArray(nodes);
        var wayMap = mapFromArray(ways);
        var relationMap = mapFromArray(relations);

        assert(relationID in relationMap);

        /* Turn a node into a lat/lon object */
        var pointFromNode = function(n) {
            return {
                lon: n.attributes.lon,
                lat: n.attributes.lat,
            };
        };

        /* Compute an ordered list of points for the relation */
        var relationNIDs = osm.waysToContiguousNIDs(
            relationMap[relationID].ways.map(function(wid) { return wayMap[wid]; }),
            nodes);
        var relationPoints = [];
        relationNIDs.forEach(function(nid) {
            relationPoints.push(pointFromNode(nodeMap[nid]));
        });

        /* Render our template */
        var templateData = '';

        var s = fs.createReadStream('static/templates/osm_view.html');
        s.on('data', function(s) {
            templateData += s;
        });

        s.on('end', function() {
            reply(
                mustache.render(
                    templateData, {
                        mapNodes: relationPoints }))
                .code(200)
                .type('text/html');
        });
    });

    op.on('error', function() {
        reply('Failed to parse OSM file');
        return;
    });

    assert('file' in req.payload);
    op.parseXMLStream(req.payload.file);
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
        handler: { file: 'static/html/viz.html' },
    }, {
        path: '/',
        method: 'GET',
        handler: { file: 'static/html/index.html' },
    }, {
        path: '/_/osm_view',
        method: 'GET',
        handler: { file: 'static/html/osm_view_form.html' },
    }, {
        path: '/_/osm_view',
        method: 'POST',
        handler: osm_view_handler,
        config: {
            payload: {
                output: 'stream',
                parse: true,
            },
        },
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
