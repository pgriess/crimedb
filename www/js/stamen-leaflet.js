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
 * A LeafletJS for Stamen map tiles as an AMD module.
 */

define(
    ['leaflet'],
    function(L) {
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
    }
);
