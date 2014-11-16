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

define(
    ['jquery', 'jquery-ui', 'leaflet', 'viz-util', 'highcharts'],
    function(jquery, jqueryUi, L, vizUtil) {
        // http://www.colorbrewer2.org/
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

        var MONTHS = [
            'January',
            'February',
            'March',
            'April',
            'May',
            'June',
            'July',
            'August',
            'September',
            'October',
            'November',
            'December',
        ];

        var currentLayers = [];
        var legendLayer = null;
        var currentBounds = null;

        var getGridData = function(cb) {
            jquery.getJSON('grid.json', cb);
        };

        var updateMap = function(map) {
            getGridData(function(gd) {
                var bounds = map.getBounds();

                // Map hasn't changed; nothing to do
                if (bounds.equals(currentBounds)) {
                    return;
                }

                currentBounds = bounds;

                // Clear current layers
                currentLayers.forEach(function(l) {
                    map.removeLayer(l);
                });

                if (legendLayer) {
                    map.removeLayer(legendLayer);
                    jquery('.legend').remove();
                }

                // Figure out the range of grid squares that are being rendered
                // by this map view
                var x_min = Math.floor((currentBounds.getWest() - gd.origin.coordinates[0]) / gd.grid_size);
                var x_max = Math.ceil((currentBounds.getEast() - gd.origin.coordinates[0]) / gd.grid_size);
                var y_min = Math.floor((currentBounds.getSouth() - gd.origin.coordinates[1]) / gd.grid_size);
                var y_max = Math.ceil((currentBounds.getNorth() - gd.origin.coordinates[1]) / gd.grid_size);

                // Run over our grid and aggregate some data for each of our
                // cells: an array of counts for use in computing percentiles,
                // and the GeoJSON objects for rendering
                var crimeCounts = Array();
                var crimeGeoJson = Array();
                for (var x = Math.max(0, x_min);
                     x < Math.min(gd.grid.length, x_max);
                     ++x) {
                    for (var y = Math.max(0, y_min);
                         y < Math.min(gd.grid[x].length, y_max);
                         ++y) {
                        if (gd.grid[x][y] < 0) {
                            continue;
                        }

                        crimeCounts.push(gd.grid[x][y]);

                        crimeGeoJson.push({
                            type: 'Feature',
                            properties: {
                                crimeCount: gd.grid[x][y],
                            },
                            geometry: {
                                type: 'Polygon',
                                coordinates: [[
                                    [gd.origin.coordinates[0] + x * gd.grid_size, gd.origin.coordinates[1] + y * gd.grid_size],
                                    [gd.origin.coordinates[0] + (x + 1) * gd.grid_size, gd.origin.coordinates[1] + y * gd.grid_size],
                                    [gd.origin.coordinates[0] + (x + 1) * gd.grid_size, gd.origin.coordinates[1] + (y + 1) * gd.grid_size],
                                    [gd.origin.coordinates[0] + x * gd.grid_size, gd.origin.coordinates[1] + (y + 1) * gd.grid_size],
                                ]],
                            },
                        })
                    }
                }

                // Compute percentiles for coloring
                var colorBuckets = vizUtil.computePercentiles(
                    crimeCounts, GRID_PERCENTILES);

                // Render the crime grid
                var l = L.geoJson(crimeGeoJson, {
                    style: function (f) {
                        return {
                            color: GRID_COLORS[
                                vizUtil.bucketForValue(
                                    f.properties.crimeCount,
                                    colorBuckets
                                )
                            ],
                            fillOpacity: 0.4,
                            stroke: false
                        };
                    }
                }).addTo(map);
                currentLayers.push(l);

                // Render the legend
                legendLayer = L.control({position: 'bottomright'});
                legendLayer.onAdd = function(map) {
                    var div = L.DomUtil.create('div', 'legend');
                    for (var i = colorBuckets.length - 1; i > 0; --i) {
                        var text = colorBuckets[i - 1] + ' - ' + colorBuckets[i];

                        div.innerHTML +=
                            '<i class="swatch" ' +
                                'style="background: ' +
                                GRID_COLORS[i - 1] +
                                ';"></i>' + text + '<br/>';
                    }

                    return div;
                };
                legendLayer.addTo(map);
            });
        };

        var updateTimeseries = function() {
            jquery.getJSON('timeseries.json',
                function(td) {
                    jquery('#timeseries-by-month').highcharts(td.by_month);
                });
        };

        var setupViz = function(initLoc) {
            jquery(document).ready(function() {
                var map = L.map('map');

                map.on('load', function() { updateMap(map); })
                    .on('viewreset', function() { updateMap(map); })
                    .on('zoomend', function() { updateMap(map); })
                    .on('moveend', function() { updateMap(map); })
                    .on('resize', function() { updateMap(map); });

                /*
                 * Add tile layer for Stamen Toner.
                 *
                 * Copied from http://maps.stamen.com/js/tile.stamen.js?v1.2.3
                 * as it could not be used directly due use of RequireJS
                 * (tile.stamen.js assumes that the 'L' global is available).
                 */
                L.StamenTileLayer = L.TileLayer.extend({
                    initialize: function(name) {
                        L.TileLayer.prototype.initialize.call(
                            this,
                            'http://{s}tile.stamen.com/toner-lite/{z}/{x}/{y}.png',
                            {
                                minZoom: 0,
                                maxZoom: 20,
                                subdomains: ['a.', 'b.', 'c.', 'd.'],
                                scheme: 'xyz',
                                attribution: 'Map tiles by <a href="http://stamen.com">Stamen Design</a>, under <a href="http://creativecommons.org/licenses/by/3.0">CC BY 3.0</a>. Data by <a href="http://openstreetmap.org">OpenStreetMap</a>, under <a href="http://creativecommons.org/licenses/by-sa/3.0">CC BY SA</a>.',
                            }
                        );
                    }
                });
                map.addLayer(new L.StamenTileLayer('toner-lite'))
                    .setView(initLoc, 14);

                updateTimeseries();
            });
        };

        return {
            setupViz: setupViz
        };
    }
);
