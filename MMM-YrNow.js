Module.register('MMM-YrNow', {
    defaults: {
        yrApiUrl: "https://www.yr.no/api/v0/locations/%s/forecast",
        updateInterval: 10000,
        symbolSize: "70px",
        forecastWrapperHeight: "100px",
        tempSize: "medium",
        nowCastText: "small"
    },

    getTranslations: function() {
        return {
            no: "translations/no.json",
        }
    },

    getScripts: function() {
        return [
            'printf.js',
            'readTextFile.js'
        ];
    },

    getStyles: function() {
        return ['mmm-yrnow.css'];
    },

    start: function() {
        this.list = null;
        this.loaded = false;
        var forecastUrl = printf(printf('%s', this.config.yrApiUrl), this.config.locationId);
        this.getForecast(forecastUrl);
        var self = this;
        setInterval(function() {
            self.updateDom(1000);
        }, 60000);
    },

    socketNotificationReceived: function(notification, payload) {
        if (notification === 'YR_FORECAST_DATA') {
            if (payload.nowcast.points != null) {
                this.processNowcast(payload.nowcast);
                if (this.config.showWeatherForecast)
                    this.processForecast(payload.forecast);
            }
            this.updateDom(1000);
        }
    },

    getForecast: function(url) {
        this.sendSocketNotification('GET_YR_FORECAST', {
            forecastUrl: url,
            config: this.config
        });
    },

    getNextPrecipStart: function() {
        return this.list.points.filter((item) =>
            item.precipitation.intensity > 0 && Date.parse(item.time) >= new Date().valueOf())[0];
    },

    getNextPrecipStop: function() {
        return this.list.points.filter((item) =>
            item.precipitation.intensity === 0 && Date.parse(item.time) >= new Date().valueOf())[0];
    },

    getMinutesTill: function(nextItemTime) {
        return Math.abs(Date.parse(nextItemTime) - new Date().valueOf()) / (1000 * 60);
    },

    getDom: function() {
        var wrapper = document.createElement('div');
        var animationWrapper = document.createElement('div');
        animationWrapper.className = 'animation small';

        if (!this.loaded) {
            wrapper.innerHTML = this.translate('loading');
            wrapper.className = 'dimmed light small';
            return wrapper;
        }
        var nowCast = this.translate('no_precip_next_90');
        var precipitationStart = this.getNextPrecipStart();
        var precipitationStop = this.getNextPrecipStop();
        var forecast = document.createElement('div');
        forecast.className = 'forecast small';
        forecast.style.height = this.config.forecastWrapperHeight;

        if (precipitationStart != null) {
            //Precip some time during the next 90 minutes
            var precipitationStartsIn = this.getMinutesTill(precipitationStart.time);
            forecast.appendChild(animationWrapper);

            //Precip now
            if (precipitationStartsIn < 7) {
                this.createAnimation(animationWrapper);
                forecast.appendChild(this.getUmbrella());
                if (precipitationStop) {
                    precipitationStopsIn = this.getMinutesTill(precipitationStop.time);
                    nowCast = printf(this.translate("precipitation_ends"), precipitationStopsIn.toFixed(0));
                }
                else
                    nowCast = this.translate("precip_next_90");
            }
            else {
                //Precip in n minutes
                forecast.appendChild(this.getUmbrella());
                nowCast = printf(this.translate("precip_in"), precipitationStartsIn.toFixed(0));
            }
        }

        if (nowCast == this.translate('no_precip_next_90') && this.config.showWeatherForecast) {
            forecast.appendChild(this.getWeatherSymbol());
        }
        wrapper.appendChild(forecast);
        wrapper.appendChild(this.getTemperature());
        wrapper.appendChild(this.createNowcastText(nowCast));

        var precipChart = this.createPrecipChart();
        if (precipChart) {
            wrapper.appendChild(precipChart);
        }

        return wrapper;
    },

    createNowcastText: function(nowCast) {
        var nowCastText = document.createElement('p');
        nowCastText.className = `precipText ${this.config.nowCastText}`;
        nowCastText.innerHTML = nowCast;
        return nowCastText
    },

    createPrecipChart: function() {
        if (!this.list || !this.list.points || this.list.points.length === 0) {
            return null;
        }

        var svgNS = 'http://www.w3.org/2000/svg';
        var width = 300;
        var height = 84;
        var topPad = 8;
        var baseline = height - 18;
        var maxMinutes = 90;

        var now = new Date().valueOf();
        var levels = this.list.chartLevels;
        var maxScale = (levels && levels.length) ? levels[levels.length - 1].max : 2;
        if (!maxScale) {
            maxScale = 2;
        }

        var coords = this.list.points.map((point) => {
            var minutesFromNow = (Date.parse(point.time) - now) / 60000;
            var intensity = (point.precipitation && point.precipitation.intensity) || 0;
            var frac = Math.sqrt(Math.min(1, intensity / maxScale));
            return {
                minutes: minutesFromNow,
                x: Math.max(0, Math.min(width, (minutesFromNow / maxMinutes) * width)),
                y: baseline - frac * (baseline - topPad)
            };
        }).filter((c) => c.minutes >= -2 && c.minutes <= maxMinutes + 2);

        if (coords.length < 2) {
            return null;
        }

        var svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('class', 'precipChart');
        svg.setAttribute('preserveAspectRatio', 'none');

        var pathData = 'M ' + coords[0].x.toFixed(1) + ' ' + baseline.toFixed(1);
        coords.forEach((c) => {
            pathData += ' L ' + c.x.toFixed(1) + ' ' + c.y.toFixed(1);
        });
        pathData += ' L ' + coords[coords.length - 1].x.toFixed(1) + ' ' + baseline.toFixed(1) + ' Z';

        var area = document.createElementNS(svgNS, 'path');
        area.setAttribute('d', pathData);
        area.setAttribute('class', 'precipChartArea');
        svg.appendChild(area);

        var base = document.createElementNS(svgNS, 'line');
        base.setAttribute('x1', 0);
        base.setAttribute('x2', width);
        base.setAttribute('y1', baseline);
        base.setAttribute('y2', baseline);
        base.setAttribute('class', 'precipChartBaseline');
        svg.appendChild(base);

        [[0, 'Nå'], [30, '30'], [60, '60'], [90, '90 min']].forEach((pair) => {
            var minute = pair[0];
            var label = pair[1];
            var x = (minute / maxMinutes) * width;
            var text = document.createElementNS(svgNS, 'text');
            text.setAttribute('x', x);
            text.setAttribute('y', height - 4);
            text.setAttribute('class', 'precipChartLabel');
            text.setAttribute('text-anchor', minute === 0 ? 'start' : (minute === maxMinutes ? 'end' : 'middle'));
            text.textContent = label;
            svg.appendChild(text);
        });

        return svg;
    },

    createAnimation: function(testElement) {
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (this.readyState == 4 && this.status == 200) {
                testElement.appendChild(xhr.responseXML.documentElement);
            }
        };
        xhr.open('GET', this.file('images/rain.svg'), true);
        xhr.send('');
    },

    getUmbrella: function() {
        var umbrella = document.createElement('img');
        umbrella.className = 'umbrella';
        umbrella.src = this.file('images/umbrella.svg');
        umbrella.style.width = this.config.symbolSize;
        umbrella.style.height = this.config.symbolSize;
        return umbrella;
    },

    getWeatherSymbol: function() {
        var symbol = document.createElement('img');
        symbol.className = 'weatherSymbol';
        symbol.src = this.file(printf('images/%s.svg', this.weatherSymbol));
        symbol.style.width = this.config.symbolSize;
        symbol.style.height = this.config.symbolSize;
        return symbol;
    },

    getTemperature: function() {
        var temp = document.createElement('div');
        temp.className = `temperature light bright ${this.config.tempSize}`;
        temp.innerHTML = printf('%s°', Math.round(this.temperature));
        return temp;
    },

    processNowcast: function(obj) {
        if (obj.points) {
            this.list = obj;
            this.loaded = true;
        }
    },

    calculateWeatherSymbolId: function(data) {
        if (!data) return '';
        let id = data.n < 10 ? printf('0%s', data.n) : data.n;
        switch (data.var) {
            case 'Sun':
                id += 'd';
                break;
            case 'PolarNight':
                id += 'm';
                break;
            case 'Moon':
                id += 'n';
                break;
        }
        return id;
    },

    processForecast: function(obj) {
        if (obj.shortIntervals) {
            this.weatherSymbol = this.calculateWeatherSymbolId(obj.shortIntervals[0].symbol);
            this.temperature = obj.shortIntervals[0].temperature.value;
            this.loaded = true;
        }
    }
});
