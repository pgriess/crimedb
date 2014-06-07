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
var path = require('path');
var request = require('request');
var strptime = require('micro-strptime').strptime;

/**
 * Given an array of OSM node objects, return a GeoJSON Polygon object
 * that represents them.
 */
var geoJSONPolygonFromOSMNodes = function(osmNodes) {
    return {
        type: 'Polygon',
        coordinates: [
            osmNodes.map(function(o) {
                return [
                    o.attributes.lon,
                    o.attributes.lat
                ];
            })
        ]
    };
};

/**
 * Send a failure response to the client.
 */
var sendFailureResponse = function(req, reply, title, problemType) {
    reply(
        JSON.stringify({
            title: title,
            problemType: 'http://' + req.info.host + '/errors/' +
                problemType}))
        .code(500)
        .type('application/api-problem+json');
};

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
            sendFailureResponse(
                req, reply, 'Invalid query parameter', 'InternalError');
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
            sendFailureResponse(
                req, reply, 'Invalid query parameter', 'InternalError');
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
                sendFailureResponse(
                    req, reply, 'Error talking to data store', 'InternalError');
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

    assert('file' in req.payload);

    osm.readFullStream(
        req.payload.file,
        function(err, osm, nodes, ways, relations) {
            if (err) {
                sendFailureResponse(req, reply, 'Failed to parse OSM file', 'InternalError');
                return;
            }

            assert(relationID in relations);

            /* Turn a node into a lat/lon object */
            var pointFromNode = function(n) {
                return {
                    lon: n.attributes.lon,
                    lat: n.attributes.lat,
                };
            };

            /* Compute an ordered list of points for the relation */
            var relationNIDs = osm.waysToContiguousNIDs(
                relations[relationID].ways.map(function(wid) { return ways[wid]; }));
            var relationPoints = [];
            relationNIDs.forEach(function(nid) {
                relationPoints.push(pointFromNode(nodes[nid]));
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
        }
    );
};

var regions_handler = function(req, reply) {
    var processRegionFile = function(fp, cb) {
        osm.readFullStream(
            fs.createReadStream(fp),
            function(err, _, nodes, ways, relations) {
                if (err) {
                    cb(err);
                    return;
                }

                assert (Object.keys(relations).length === 1);
                var rid = Object.keys(relations)[0];
                var nids = osm.waysToContiguousNIDs(
                    relations[rid].ways.map(
                        function(wid) { return ways[wid]; }));

                var fn = path.basename(fp);
                var regionName = fn.substr(
                    0, fn.length - path.extname(fn).length);

                /* XXX: Assumes that a region is contiguous as it
                 *      returns GeoJSON polygon objects. If we want to
                 *      handle discontiguous regions, we should return
                 *      MultiPolygon.
                 */
                cb(
                    null,
                    regionName,
                    geoJSONPolygonFromOSMNodes(
                        nids.map(function(nid) { return nodes[nid]; }))
                );
            }
        );
    };

    fs.readdir('static/regions', function(err, files) {
        if (err) {
            sendFailureResponse(
                req, reply, 'Error getting list of regions',
                'InternalError');
            return;
        }

        var outstandingFiles = files.length;
        var responseSent = false;
        var responseObj = {
            regions: {
            },
        };

        files.forEach(function(fn) {
            processRegionFile('static/regions/' + fn, function(err, name, geo) {
                if (err) {
                    sendFailureResponse(
                        req, reply, 'Error processing region file',
                        'InternalError');
                    responseSent = true;
                    return;
                }

                --outstandingFiles;
                responseObj.regions[name] = geo;

                if (outstandingFiles == 0 && !responseSent) {
                    reply(JSON.stringify(responseObj))
                        .code(200)
                        .type('application/vnd.crimed.org+json');
                }
            });
        });
    });
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
        path: '/regions',
        method: 'GET',
        handler: regions_handler,
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
