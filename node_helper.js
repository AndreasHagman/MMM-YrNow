var NodeHelper = require('node_helper');
var request = require('request');

module.exports = NodeHelper.create({
	start: function() {
		console.log('Starting node helper for: ' + this.name);
        this.config = null;
        this.forecastUrl = '';
        this.timer = null;
	},

	socketNotificationReceived: function(notification, payload) {
		var self = this;
        if(notification === 'GET_YR_FORECAST') {
            self.config = payload.config;
            self.forecastUrl = payload.forecastUrl;
            clearTimeout(this.timer);
            this.getForecast();
        }
	},

    parseJson: function(message, what) {
        try {
            return JSON.parse(message);
        } catch (e) {
            console.error('[MMM-YrNow] Invalid JSON from ' + what + ': ' + e.message);
            return null;
        }
    },

	getForecast: function() {
		var self = this;
        var locationData = {};
        var nowcastUrl = this.forecastUrl + '/now';

        var scheduleNext = function() {
            clearTimeout(self.timer);
            self.timer = setTimeout(function() { self.getForecast(); }, self.config.updateInterval);
        };

        request({url: nowcastUrl, method: 'GET'}, function(error, response, message) {
            if (error || !(response.statusCode == 200 || response.statusCode == 304)) {
                console.error('[MMM-YrNow] Nowcast request failed: ' + (error ? error.message : 'HTTP ' + response.statusCode));
                self.sendSocketNotification('YR_FORECAST_ERROR', { reason: 'nowcast_request_failed' });
                scheduleNext();
                return;
            }

            locationData.nowcast = self.parseJson(message, 'nowcast');
            if (!locationData.nowcast) {
                self.sendSocketNotification('YR_FORECAST_ERROR', { reason: 'nowcast_invalid_json' });
                scheduleNext();
                return;
            }
            if (locationData.nowcast.radarIsDown) {
                console.warn('[MMM-YrNow] Yr reports radarIsDown=true, nowcast unavailable');
            }
            self.setNextUpdate(response.headers);

            request({url: self.forecastUrl, method: 'GET'}, function(error, response, message) {
                if (!error && (response.statusCode == 200 || response.statusCode == 304)) {
                    locationData.forecast = self.parseJson(message, 'forecast');
                } else {
                    console.error('[MMM-YrNow] Forecast request failed: ' + (error ? error.message : 'HTTP ' + response.statusCode));
                }
                self.sendSocketNotification('YR_FORECAST_DATA', locationData);
            });
            scheduleNext();
        });
	},

    setNextUpdate: function(headers) {
        var cacheControlHeader = headers && headers['cache-control'];
        var match = cacheControlHeader && cacheControlHeader.match(/max-age=(\d+)/);
        if (match) {
            // Minimum 60 s so a tiny max-age never hammers the API
            this.config.updateInterval = Math.max(60, parseInt(match[1], 10)) * 1000;
        }
    }
});
