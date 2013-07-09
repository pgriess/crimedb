/*
 * Common utilities.
 */

/*
 * Format a Date object into the YYYY-MM-DDTHH:MM:SSZ format that Solr expects
 * for its date fields.
 */
var formatDateForSolr = function(d) {
    return d.getUTCFullYear() + '-' +
        (d.getMonth() + 1) + '-' +
        d.getUTCDate() +
        'T' +
        d.getUTCHours() + ':' +
        d.getUTCMinutes() + ':' +
        d.getUTCSeconds() +
        'Z';
};
exports.formatDateForSolr = formatDateForSolr;
