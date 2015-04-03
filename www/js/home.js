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
 * JavaScript for the CrimeDB homepage.
 */

requirejs.config({
    baseUrl: '/js',
    paths: {
        async: 'lib/requirejs/async',
    },
});

requirejs(
    ['leaflet', 'jquery', 'gmaps', 'ga', 'page', 'crimedb-leaflet', 'stamen-leaflet'],
    function(L, $, gmaps, ga, page) {
        /*
         * This is necessary because by default LeafletJS expects icons to be
         * available relative to the JS source path. This makes sense if we're
         * using it via their CDN (which hosts the images), but not so much
         * since we're hosting it ourseles (so that we can use AMD).
         *
         * TODO: We should either update the local copy of leaflet.js with the
         *       below snippet, or figure out a better way of wrapping this in
         *       an AMD definition such that that doesn't break.
         */
        L.Icon.Default.imagePath = '//cdn.leafletjs.com/leaflet-0.6.4/images';

        var geocoder = new gmaps.Geocoder();
        var marker = null;

        /*
         * Return a URL string for the given location.
         */
        var getPageLocationURL = function(lat, lon) {
            var url = '/v1/' + lat.toFixed(4) + '/' + lon.toFixed(4);

            return url;
        };

        /*
         * Geocode the given address and update the map / history if we find
         * anything.
         */
        var goToAddress = function(map, address) {
            if (ga) {
                ga('send', 'event', 'map', 'go');
            }

            if (marker) {
                map.removeLayer(marker);
                marker = null;
            }

            geocoder.geocode({address: address}, function(results, status) {
                if (status === gmaps.GeocoderStatus.OK) {
                    var loc = results[0].geometry.location;
                    var latLng = [loc.lat(), loc.lng()];

                    marker = L.marker(latLng);
                    map.addLayer(marker);

                    page.show(getPageLocationURL(loc.lat(), loc.lng(), 14));
                }
            });
        };

        /*
         * Render the view for a given location.
         */
        var renderLocationView = function(map, ctx, next) {
            map.setView([ctx.params.lat, ctx.params.lon], 14);
        };

        /*
         * Update the URL / history based on the contents of the page.
         */
        var updatePageHistory = function(map) {
            var loc = map.getCenter();
            page.show(
                getPageLocationURL(loc.lat, loc.lng),
                undefined,
                false);
        };

        $(document).ready(function() {
            if (ga) {
                ga('create', 'UA-18586119-3', 'crimedb.org');
                ga('send', 'pageview');
            }

            var map = L.map('map');

            map.addLayer(new L.StamenTileLayer('toner-lite'))
                .addLayer(new L.CrimeDBLayer());

            /*
             * Listen for the user navigating on the map and turn these into
             * URL / history events.
             *
             * We use 'dragend' here rather than 'moveend' because the latter
             * is triggered by *any* movement of the map (e.g.  setView()).
             * Use of that event would cause every navigation (including by
             * going forward / backward in history) to generate a new history
             * frame. In addition, we explicitly tell page.show() not to
             * dispatch because the page already reflects the state of the new
             * location; no need to re-render it.
             */
            map.on('dragend', updatePageHistory.bind(null, map));

            $('#gobutton').click(function() {
                goToAddress(map, $('#address').val());
            });

            page('/v1/:lat/:lon', renderLocationView.bind(null, map));

            // By default, go an area of St. Louis, MO that is known to have
            // good data
            page.redirect('', getPageLocationURL(38.638641, -90.283651));

            page.start({hashbang: true});
        });
    }
);
