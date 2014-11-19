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
 *
 * A LeafletJS plugin to show CrimeDB data as a map overlay.
 */

define(
    ['jquery', 'leaflet'],
    function($, L) {
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

        var CrimeDBLayer = L.Class.extend({
            initialize: function(region) {
                var self = this;

                self.region = region;
                self.currentLayers = [];
                self.currentBounds = null;
                self.crimeDBData = null;
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

                $.getJSON(
                    '//www.crimedb.org/d/' + this.region + '/grid.json',
                    function(gd) {
                        self.crimeDBData = gd;
                        self.update(map);
                    }
                );
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

                // If the map hasn't moved, there's nothing to do
                var bounds = map.getBounds();
                if (bounds.equals(self.currentBounds)) {
                    return;
                }

                self.currentBounds = bounds;

                // If there is no data to render, there is nothing to do
                var gd = self.crimeDBData;
                if (!gd) {
                    return;
                }

                // Clear out the current view, including the legend
                self.currentLayers.forEach(function(l) {
                    map.removeLayer(l);
                });
                self.currentLayers = [];
                $('.legend').remove();

                // Figure out the range of grid squares that are being rendered
                // by this map view
                var x_min = Math.floor((bounds.getWest() - gd.origin.coordinates[0]) / gd.grid_size);
                var x_max = Math.ceil((bounds.getEast() - gd.origin.coordinates[0]) / gd.grid_size);
                var y_min = Math.floor((bounds.getSouth() - gd.origin.coordinates[1]) / gd.grid_size);
                var y_max = Math.ceil((bounds.getNorth() - gd.origin.coordinates[1]) / gd.grid_size);

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
                l.addTo(map);
                self.currentLayers.push(l);
            }
        });

        return {
            CrimeDBLayer: CrimeDBLayer
        };
    }
);
