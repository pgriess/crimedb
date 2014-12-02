/*!
 * Copyright 2014 Peter Griess
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*
 * A LeafletJS plugin to show CrimeDB data as a map overlay.
 */

/*
 * Wrapper syntax allows use as both an AMD module and a regular <script>
 * included file. Copied from https://github.com/umdjs/umd.
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['jquery', 'leaflet'], factory);
    } else {
        // Browser globals
        root.crimedb = factory(root.$, root.L);
    }
}(this, function ($, L) {
    // Colors to use for our heatmap; from http://www.colorbrewer2.org/
    var GRID_COLORS = [
        '#3288BD',
        '#66C2A5',
        '#ABDDA4',
        '#E6F598',
        '#FEE08B',
        '#FDAE61',
        '#F46D43',
        '#D53E4F',
    ];

    // Percentiles to use in our legend
    var GRID_PERCENTILES = [
        0.0,
        0.10,
        0.25,
        0.50,
        0.75,
        0.90,
        0.95,
        0.99,
        1.0
    ];

    /**
     * Compute the requested percentiles (which must be in the range [0,
     * 1.0]) for the given array of values, returning them in an array.
     */
    var computePercentiles = function(values, percentiles) {
        var sortedValues = values.slice(0);
        sortedValues.sort(function(a, b) { return a - b; });

        return percentiles.map(function(p) {
            return sortedValues[Math.floor((sortedValues.length - 1) * p)];
        });
    };

    /**
     * Given a sorted array representing bucket boundaries,
     * return the index of the bucket to which the given value
     * belongs.
     */
    var bucketForValue = function(value, percentileBuckets) {
        for (var i = 0; i < percentileBuckets.length - 1; ++i) {
            if (percentileBuckets[i] > percentileBuckets[i + 1]) {
                throw 'Percentile buckets are not sorted!';
            }

            if (value >= percentileBuckets[i] &&
                value <= percentileBuckets[i + 1]) {
                return i;
            }
        }

        throw 'Could not find bucket for value!';
    };

    /**
     * Figure out the set of tiles needed to render the given LeafletJS map.
     *
     * Note: Code for lon2tile() and lat2tile() is from
     *       http://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
     */
    var lon2tile = function(lon, zoom) {
        return Math.floor((lon + 180.0) / 360.0 * Math.pow(2, zoom));
    };
    var lat2tile = function(lat, zoom) {
        return Math.floor((1.0 - Math.log(Math.tan(lat * Math.PI / 180.0) + 1 / Math.cos(lat * Math.PI / 180.0)) / Math.PI) / 2.0 * Math.pow(2, zoom));
    };
    var tilesForMap = function(map) {
        var bounds = map.getBounds();
        var zoom = Math.min(14, map.getZoom());

        var x_min = lon2tile(bounds.getWest(), zoom);
        var x_max = lon2tile(bounds.getEast(), zoom);
        var y_min = lat2tile(bounds.getNorth(), zoom);
        var y_max = lat2tile(bounds.getSouth(), zoom);

        if (x_min > x_max || y_min > y_max) {
            throw 'Unexpected bounds!';
        }

        var tiles = [];
        for (var x = x_min; x <= x_max; ++x) {
            for (var y = y_min; y <= y_max; ++y) {
                tiles.push({
                    z: zoom,
                    x: x,
                    y: y,
                });
            }
        }

        return tiles;
    };

    /**
     * Get the URL from which to fetch a grid tile.
     */
    var gridUrl = function(x, y, z) {
        return '//www.crimedb.org/grid-data/' +
            z + '/' + x + '/' + y + '.json';
    };

    var CrimeDBLayer = L.Class.extend({
        initialize: function() {
            var self = this;

            self.currentLayers = [];
            self.currentBounds = null;
            self.crimeDBData = {};
            self.updateCallback = null;
        },

        onAdd: function(map) {
            var self = this;

            self.updateCallback = self.update.bind(self, map);
            map.on('load', self.updateCallback)
                .on('viewreset', self.updateCallback)
                .on('zoomend', self.updateCallback)
                .on('moveend', self.updateCallback)
                .on('resize', self.updateCallback);

            // Perform the initial udpate rather than waiting for the user
            // to do something
            self.updateCallback();
        },

        onRemove: function(map) {
            var self = this;

            if (self.updateCallback) {
                map.off('load', self.updateCallback)
                    .off('viewreset', self.updateCallback)
                    .off('zoomend', self.updateCallback)
                    .off('moveend', self.updateCallback)
                    .off('resize', self.updateCallback);
            }

            self.currentLayers.forEach(function(l) {
                map.removeLayer(l);
            });
            self.currentLayers = [];
        },

        update: function(map) {
            var self = this;

            // Kick off a fetch for each of the tiles that we need to render
            // the current map.
            tilesForMap(map).forEach(function(t) {

                // If we have all of the tiles that we need to render the
                // grid, go ahead and do it. Note that this re-computes the
                // set of tiles needed because the map may have moved since
                // we initially performed the fetch.
                var maybeRenderGrid = function() {
                    var haveAllData = tilesForMap(map).reduce(
                        function(acc, t) {
                            return acc && (gridUrl(t.x, t.y, t.z) in self.crimeDBData);
                        },
                        true
                    );

                    if (!haveAllData) {
                        return;
                    }

                    self.renderTileData(map);
                };

                var url = gridUrl(t.x, t.y, t.z);
                if (url in self.crimeDBData) {
                    maybeRenderGrid();
                } else {
                    $.ajax(url, {
                        success: function(gd) {
                            self.crimeDBData[url] = gd;
                        },

                        statusCode: {
                            // If we get a 404 from the server that just
                            // means that there is no data for this tile.
                            // Mark it as such and move on.
                            404: function() {
                                self.crimeDBData[url] = null;
                            },
                        },

                        // Regardless of success/failure we should attempt
                        // to render things.
                        complete: function() {
                            maybeRenderGrid();
                        },

                        // TODO: Need failure handler to retry on timeouts
                        //       and other soft errors.
                    });
                }
            });
        },

        renderTileData: function(map) {
            var self = this;

            // If the map hasn't moved, there's nothing to do
            var bounds = map.getBounds();
            if (bounds.equals(self.currentBounds)) {
                return;
            }

            self.currentBounds = bounds;

            // Clear out the current view, including the legend
            self.currentLayers.forEach(function(l) {
                map.removeLayer(l);
            });
            self.currentLayers = [];
            $('.crimeDBLegend').remove();

            var gd = tilesForMap(map).reduce(
                function(acc, t) {
                    var td = self.crimeDBData[gridUrl(t.x, t.y, t.z)];

                    // Not all cells have data, e.g. if we got a 404 from
                    // the server for this tile
                    if (td) {
                        acc = acc.concat(td);
                    }

                    return acc;
                },
                []
            );

            var crimeCounts = gd.map(function(gc) { return gc.crime_count; });
            var crimeGeoJson = gd.map(function(gc) {
                var cnt = gc.crime_count;

                // The 'geometry' property will contain the 'crime_count'
                // value as well, which is kind of weird. It would be nice
                // for this to be strictly GeoJSON, but that requires
                // copying the gc object (which seems non-trivial in JS)
                // and then deleting the 'crime_count' field.
                return {
                    type: 'Feature',
                    properties: {
                        crimeCount: cnt,
                    },
                    geometry: gc,
                };
            });

            // Compute percentiles for coloring
            var colorBuckets = computePercentiles(
                crimeCounts, GRID_PERCENTILES);

            // Render the crime grid
            var l = L.geoJson(crimeGeoJson, {
                style: function (f) {
                    return {
                        color: GRID_COLORS[
                            bucketForValue(
                                f.properties.crimeCount,
                                colorBuckets
                            )
                        ],
                        fillOpacity: 0.4,
                        stroke: false
                    };
                }
            }).addTo(map);
            self.currentLayers.push(l);

            l = L.control({position: 'bottomright'});
            l.onAdd = function(map) {
                var legendDiv = L.DomUtil.create('div', 'crimeDBLegend');
                legendDiv.setAttribute(
                    'style',
                    'background: white; ' +
                        'opacity: 1.0; ' +
                        'padding: 5px; ' +
                        'margin: 5px; ' +
                        'border: 1px solid grey;'
                );
                for (var i = colorBuckets.length - 1; i > 0; --i) {
                    var swatch = L.DomUtil.create('i', '', legendDiv);
                    swatch.setAttribute(
                        'style',
                        'background: ' + GRID_COLORS[i - 1] + ';' +
                            'height: 10px; ' +
                            'width: 10px; ' +
                            'margin: 3px; ' +
                            'float: left; ' +
                            'opacity: 0.4;'
                    );
                    var label = L.DomUtil.create('span', '', legendDiv);
                    label.innerHTML = colorBuckets[i - 1] + ' - ' + colorBuckets[i];
                    L.DomUtil.create('br', '', legendDiv);
                }

                return legendDiv;
            };
            l.addTo(map);
            self.currentLayers.push(l);
        }
    });

    return {
        CrimeDBLayer: CrimeDBLayer
    };
}));
