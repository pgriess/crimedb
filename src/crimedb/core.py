'''
Core classes and methods for CrimeDB.
'''

import datetime

RFC3999_STRFTIME_FORMAT = '%Y-%m-%dT%H:%M:%S%z'


class Crime:
    '''
    A single crime.
    '''
    
    def __init__(self, description, time, location):
        '''
        Create a new Crime object.

        The location field is a (lon, lat) tuple in WGS84 coordinates.
        '''

        self.description = description
        self.time = time
        self.location = location


def crime2json_obj(crime):
    '''
    Return a Python object representing the given crime suitable for
    converting to JSON.
    '''

    return {
        'description': crime.description,
        'time': crime.time.strftime(RFC3999_STRFTIME_FORMAT),
        'geo': {
            'type': 'Point',
            'coordinates': crime.location,
        },
    }
