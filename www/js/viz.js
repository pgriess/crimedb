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
    ['jquery', 'jquery-ui', 'leaflet', 'highcharts', 'crimedb-leaflet'],
    function(jquery, jqueryUi, L, highcharts, crimedb) {
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

        var updateTimeseries = function() {
            jquery.getJSON('timeseries.json',
                function(td) {
                    jquery('#timeseries-by-month').highcharts(td.by_month);
                });
        };

        var setupViz = function(region, initLoc) {
            jquery(document).ready(function() {
                var map = L.map('map');

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
                map.addLayer(new crimedb.CrimeDBLayer(region));

                updateTimeseries();
            });
        };

        return {
            setupViz: setupViz
        };
    }
);
