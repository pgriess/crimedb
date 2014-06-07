/*
 * OpenStreetMap utilities.
 */

var assert = require('assert');
var events = require('events');
var sax = require('sax');
var sys = require('sys');

var OSMObject = function(name) {
    var self = this;
    self.name = name;
    self.tags = {};
};

var Node = function() {
    var self = this;
    OSMObject.call(self, 'node');
};
sys.inherits(Node, OSMObject);
exports.Node = Node;

var Way = function() {
    var self = this;
    OSMObject.call(self, 'way');

    self.nodes = [];
};
sys.inherits(Way, OSMObject);
exports.Way = Way;

var Relation = function() {
    var self = this;
    OSMObject.call(self, 'relation');

    self.ways = [];
};
sys.inherits(Relation, OSMObject);
exports.Relation = Relation;

/**
 * Parser object.
 */
var Parser = function() {
    var self = this;
    events.EventEmitter.call(self);

    /* Stack of tags that we're processing */
    var tagStack = [];

    /**
     * Parse a stream containing OSM XML data.
     */
    self.parseXMLStream = function(stream) {
        saxStream = sax.createStream(true, {
            lowercase: true,
            position: true 
        });
        saxStream.on('error', function(e) {
            console.error('Error: ' + e);
        });
        saxStream.on('opentag', function(tag) {
            /*
             * Emit the 'osm' tag/event quickly so that the application knows
             * how to interpret the coming tags.
             */
            if (tag.name == 'osm') {
                self.emit('osm', tag.attributes, saxStream._parser.position);
                return;
            }

            /* Handle tags that are our primary entities */
            var obj = undefined;
            if (tag.name == 'node') {
                obj = new Node();
            } else if (tag.name == 'relation') {
                obj = new Relation();
            } else if (tag.name == 'way') {
                obj = new Way();
            }
            if (obj) {
                obj.attributes = tag.attributes;
                tagStack.push({ name: tag.name, obj: obj });
                return;
            }

            /* Handle tags that are children of other tags */
            if (tag.name == 'tag') {
                var t = tagStack[tagStack.length - 1];
                t.obj.tags[tag.attributes.k] = tag.attributes.v;
            } else if (tag.name == 'nd') {
                var t = tagStack[tagStack.length - 1];
                t.obj.nodes.push(tag.attributes.ref);
            } else if (tag.name == 'member') {
                if (tag.attributes.type == 'way') {
                    var t = tagStack[tagStack.length - 1];
                    t.obj.ways.push(tag.attributes.ref);
                }
            }
        });
        saxStream.on('closetag', function(name) {
            if (tagStack.length > 1) {
                tagStack.forEach(function (t) {
                    console.error('  ' + t.name);
                });
                throw "Too many tags!";
            }

            if (tagStack.length == 0) {
                return;
            }

            if (tagStack[tagStack.length - 1].name != name) {
                return;
            }

            var t = tagStack.pop();
            self.emit(name, t.obj, saxStream._parser.position);
        });
        saxStream.on('end', function() { self.emit('end'); });

        stream.pipe(saxStream);
    };
};
sys.inherits(Parser, events.EventEmitter);
exports.Parser = Parser;

/**
 * Given an ordered array of ways (e.g. from a relation), return
 * an ordered array of NIDs. The returned NIDs are not ordered
 * according to the way ordering. Instead, it is assumed that each
 * subsequent way joins either to the front or back of the node
 * list thus far constructed. Append (or prepend) nodes from each
 * way as necessary.
 *
 * N.B. Although each way is ordered, we may need to reverse it
 *      in order to properly append/prepend.
 */
var waysToContiguousNIDs = function(ways) {
    var nids = [];
    ways.forEach(function (w) {
        var wayNids = w.nodes;

        if (nids.length === 0) {
            nids = wayNids;
        } else if (wayNids[wayNids.length - 1] === nids[nids.length - 1]) {
            nids = nids.concat(wayNids.reverse());
        } else if (wayNids[wayNids.length - 1] === nids[0]) {
            nids = wayNids.concat(nids);
        } else if (wayNids[0] === nids[0]) {
            nids = wayNids.reverse().concat(nids);
        } else if (wayNids[0] === nids[nids.length - 1]) {
            nids = nids.concat(wayNids);
        } else {
            assert.fail('Unexpected condition!');
        }
    });

    return nids;
};
exports.waysToContiguousNIDs = waysToContiguousNIDs;

/**
 * Load an entire OSM file into memory.
 *
 * This is a convenience API intended for use in small OSM files. The
 * callback is invoked with a series of objects mapping IDs to
 * objects.
 */
var readFullStream = function(stream, cb) {
    op = new Parser();

    var osm = undefined;
    op.on('osm', function(o) {
        osm = o;
    });

    var nodes = {};
    op.on('node', function(n) {
        nodes[n.attributes.id] = n;
    });

    var ways = [];
    op.on('way', function(w) {
        ways[w.attributes.id] = w;
    });

    var relations = [];
    op.on('relation', function(r) {
        relations[r.attributes.id] = r;
    });

    op.on('end', function() {
        cb(null, osm, nodes, ways, relations);
    });

    op.on('error', function(err) {
        cb(err);
    });

    op.parseXMLStream(stream);
};
exports.readFullStream = readFullStream;
