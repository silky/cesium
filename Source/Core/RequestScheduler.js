/*global define*/
define([
        './Check',
        './defined',
        './isDataUri'
    ], function(
        Check,
        defined,
        isDataUri) {
    'use strict';

    var stats = {
        numberOfRequestsThisFrame : 0
    };

    /**
     * This class tracks the number of active requests in progress
     * and prioritizes incoming requests.
     *
     * @exports RequestScheduler
     *
     * @private
     */
    function RequestScheduler() {
    }

    /**
     * Issuers of a request should update properties of requests. At the end of the frame,
     * RequestScheduler.update is called to issue / reschedule / defer / cancel requests.
     */
    RequestScheduler.update = function() {
        showStats();
        clearStats();

        if (!RequestScheduler.throttle) {
            return;
        }

        // TODO
    };

    /**
     * Issue a request. If request.throttle is false, the request is sent immediately. Otherwise the request will be
     * queued and sorted by priority before being sent. If there are too many active requests this will return undefined.
     *
     * @param {Request} request The request object.
     *
     * @returns {Promise.<Object>} A Promise for the requested data.
     */
    RequestScheduler.request = function(request) {
        //>>includeStart('debug', pragmas.debug);
        Check.defined('request', request);
        //>>includeEnd('debug');

        ++stats.numberOfRequestsThisFrame;

        if (!RequestScheduler.throttle || !request.throttle || isDataUri(request.url)) {
            return request.requestFunction();
        }

        // TODO
        return request.requestFunction();
    };

    function clearStats() {
        stats.numberOfRequestsThisFrame = 0;
    }

    function showStats() {
        if (!RequestScheduler.debugShowStatistics) {
            return;
        }

        if (stats.numberOfRequestsThisFrame > 0) {
            console.log('Number of requests attempted: ' + stats.numberOfRequestsThisFrame);
        }

        // TODO : console.log number of active requests
    }

    /**
     * Specifies the maximum number of requests that can be simultaneously open.
     * @type {Number}
     * @default 50
     */
    RequestScheduler.maximumRequests = 50;

    /**
     * Specifies if the request scheduler should throttle incoming requests, or let the browser queue requests under its control.
     * @type {Boolean}
     * @default true
     */
    RequestScheduler.throttle = true;

    /**
     * When true, log statistics to the console every frame
     * @type {Boolean}
     * @default false
     */
    RequestScheduler.debugShowStatistics = false;

    return RequestScheduler;
});
