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
 * Wrap the Google Analytics API in an AMD module.
 */

define(
    function() {
        // Disable Google Analytics if we have the 'noga' cookie set to 1
        //
        // This cookie gets set in the Apache configs for CrimeDB development.
        // Although it's not set in production the cookie's domain and path
        // will cause it to be sent to production as well.
        if (document.cookie.search(/\bnoga=1\b/) >= 0) {
            return undefined;
        }

        (function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
        (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
        m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
        })(window,document,'script','//www.google-analytics.com/analytics.js','ga');

        return window.ga;
    }
);
