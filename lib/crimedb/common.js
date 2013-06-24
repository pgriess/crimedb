/*
 * Common utilities for CrimeDB.
 */

var couchdb = require('felix-couchdb');
var fs = require('fs');
var path = require('path');
var url = require('url');
var util = require('util');

/*
 * Load design documents from the filesystem into the given database.
 *
 * This expects the provided filesystem path to point to a directory with a
 * hierarchy that looks like: /<design-name>/views/<view-name>/{map,reduce}.
 */
var importDesignDocs = function(dbHandle, designRoot, callback) {
    /* Load a view as an object */
    var loadView = function(viewDir) {
        view = {};

        fs.readdirSync(viewDir).forEach(function(fn) {
            var viewPath = path.join(viewDir, fn);
            if (!fs.statSync(viewPath).isFile()) {
                return;
            }

            view[fn] = fs.readFileSync(viewPath, 'ascii');
        });

        return view;
    };

    /* Load all views as objects */
    var loadViews = function(viewsDir) {
        var views = {};

        fs.readdirSync(viewsDir).forEach(function(fn) {
            var viewDir = path.join(viewsDir, fn);
            if (!fs.statSync(viewDir).isDirectory()) {
                return;
            }

            views[fn] = loadView(viewDir);
        });

        return views;
    };

    /* Load a single design document directory as an object */
    var loadDesign = function(designDir) {
        return {
            _id: '_design/' + path.basename(designDir),
            views: loadViews(path.join(designDir, 'views'))
        };
    }

    /* Load all designs as objects */
    var loadDesigns = function(designsDir) {
        var designs = [];

        fs.readdirSync(designsDir).forEach(function(fn) {
            var designDir = path.join(designsDir, fn);
            if (!fs.statSync(designDir).isDirectory()) {
                return;
            }

            designs.push(loadDesign(designDir));
        });

        return designs;
    };

    dbHandle.bulkDocs({docs: loadDesigns(designRoot)}, function(err) {
        callback(err);
    });
};
exports.importDesignDocs = importDesignDocs;

/*
 * Return a CouchDB database handle object from a URL.
 */
var getDBFromURL = function(urlStr) {
    var couchdb_url = url.parse(urlStr);
    if (!couchdb_url.port) {
        couchdb_url.port = 5984;
    }

    var clientHandle = couchdb.createClient(
        couchdb_url.port, couchdb_url.hostname);

    return clientHandle.db(couchdb_url.path.substr(1));
};
exports.getDBFromURL = getDBFromURL;

/*
 * Get a CouchDB database handle from a URL, optionally creating and/or
 * destroying the database along the way.
 */
var getDB = function(urlStr, createIfDoesNotExist, destroyIfExists, callback) {
    var dbHandle = getDBFromURL(urlStr);

    var createDB = function() {
        dbHandle.create(function(err) {
            if (err) {
                callback(err, null);
                return;
            }

            importDesignDocs(
                dbHandle,
                path.join(__dirname, '..', '..', 'couchdb', 'designs'),
                function(err) {
                    callback(err, (err) ? null : dbHandle);
                }
            );
        });
    };

    dbHandle.exists(function(err, exists) {
        if (err) {
            callback(err, null);
            return;
        }

        if (exists) {
            if (!destroyIfExists) {
                callback(null, dbHandle);
                return;
            }

            dbHandle.remove(function(err) {
                if (err) {
                    callback(err, null);
                    return;
                }

                createDB();
            });
            return;
        }

        if (!createIfDoesNotExist) {
            callback(Error('Database does not exist'), null);
            return;
        }

        createDB();
    });
};
exports.getDB = getDB;
