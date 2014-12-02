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
 * Boilerplate for visualizing a CrimeDB region.
 */

define(
    ['jquery', 'leaflet', 'highcharts', 'crimedb-leaflet', 'stamen-leaflet'],
    function(jquery, L, highcharts, crimedb, _) {
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

                map.addLayer(new L.StamenTileLayer('toner-lite'))
                    .setView(initLoc, 14);
                map.addLayer(new crimedb.CrimeDBLayer());

                updateTimeseries();

                // Add a path tracing the outline of the region
                jquery.getJSON(
                    '//data.crimedb.org/' + region + '/',
                    function(rd) {
                        var l = L.geoJson(rd.geo, {
                            style: function(feature) {
                                return {
                                    fill: false,
                                };
                            }
                        });
                        map.addLayer(l);
                    }
                );
            });
        };

        return {
            setupViz: setupViz
        };
    }
);
