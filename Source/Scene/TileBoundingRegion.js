/*global define*/
define([
        '../Core/Cartesian3',
        '../Core/Cartographic',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/DeveloperError',
        '../Core/Ellipsoid',
        '../Core/OrientedBoundingBox',
        '../Core/Rectangle',
        './SceneMode'
    ], function(
        Cartesian3,
        Cartographic,
        defaultValue,
        defined,
        defineProperties,
        DeveloperError,
        Ellipsoid,
        OrientedBoundingBox,
        Rectangle,
        SceneMode) {
    "use strict";

// TODO: replace code in GlobeSurfaceTile.js and GlobeSurfaceTileProvider.js

    /**
     * @param {Object} options Object with the following properties:
     * @param {Rectangle} options.rectangle
     * @param {Number} [options.minimumHeight=0.0]
     * @param {Number} [options.maximumHeight=0.0]
     * @param {Ellipsoid} [options.ellipsoid=Cesium.Ellipsoid.WGS84]
     *
     * @private
     */
    var TileBoundingRegion = function(options) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(options.rectangle)) {
            throw new DeveloperError('options.url is required.');
        }
        //>>includeEnd('debug');

        this.rectangle = Rectangle.clone(options.rectangle);
        this.minimumHeight = defaultValue(options.minimumHeight, 0.0);
        this.maximumHeight = defaultValue(options.maximumHeight, 0.0);

        /**
         * The world coordinates of the southwest corner of the tile's rectangle.
         *
         * @type {Cartesian3}
         * @default Cartesian3()
         */
        this.southwestCornerCartesian = new Cartesian3();

        /**
         * The world coordinates of the northeast corner of the tile's rectangle.
         *
         * @type {Cartesian3}
         * @default Cartesian3()
         */
        this.northeastCornerCartesian = new Cartesian3();

        /**
         * A normal that, along with southwestCornerCartesian, defines a plane at the western edge of
         * the tile.  Any position above (in the direction of the normal) this plane is outside the tile.
         *
         * @type {Cartesian3}
         * @default Cartesian3()
         */
        this.westNormal = new Cartesian3();

        /**
         * A normal that, along with southwestCornerCartesian, defines a plane at the southern edge of
         * the tile.  Any position above (in the direction of the normal) this plane is outside the tile.
         * Because points of constant latitude do not necessary lie in a plane, positions below this
         * plane are not necessarily inside the tile, but they are close.
         *
         * @type {Cartesian3}
         * @default Cartesian3()
         */
        this.southNormal = new Cartesian3();

        /**
         * A normal that, along with northeastCornerCartesian, defines a plane at the eastern edge of
         * the tile.  Any position above (in the direction of the normal) this plane is outside the tile.
         *
         * @type {Cartesian3}
         * @default Cartesian3()
         */
        this.eastNormal = new Cartesian3();

        /**
         * A normal that, along with northeastCornerCartesian, defines a plane at the eastern edge of
         * the tile.  Any position above (in the direction of the normal) this plane is outside the tile.
         * Because points of constant latitude do not necessary lie in a plane, positions below this
         * plane are not necessarily inside the tile, but they are close.
         *
         * @type {Cartesian3}
         * @default Cartesian3()
         */
        this.northNormal = new Cartesian3();

        var ellipsoid = defaultValue(options.ellipsoid, Ellipsoid.WGS84);
        computeBox(this, options.rectangle, ellipsoid);

        /**
         * An oriented bounding box that encloses this tile's region.
         * This is used to calculate tile visibility.
         *
         * @type {OrientedBoundingBox}
         * @default OrientedBoundingBox()
         *
         * @private
         */
        this._orientedBoundingBox = OrientedBoundingBox.fromPoints([this.southwestCornerCartesian, this.northeastCornerCartesian]);
    };

    defineProperties(TileBoundingRegion.prototype, {
        /**
         * The underlying bounding volume
         *
         * @memberof TileBoundingRegion.prototype
         *
         * @type {Object}
         * @readonly
         */
        boundingVolume : {
            get : function() {
                return this;
            }
        }
    });

    var cartesian3Scratch = new Cartesian3();
    var cartesian3Scratch2 = new Cartesian3();
    var westernMidpointScratch = new Cartesian3();
    var easternMidpointScratch = new Cartesian3();
    var cartographicScratch = new Cartographic();

    function computeBox(tileBB, rectangle, ellipsoid) {
        ellipsoid.cartographicToCartesian(Rectangle.southwest(rectangle), tileBB.southwestCornerCartesian);
        ellipsoid.cartographicToCartesian(Rectangle.northeast(rectangle), tileBB.northeastCornerCartesian);

        // The middle latitude on the western edge.
        cartographicScratch.longitude = rectangle.west;
        cartographicScratch.latitude = (rectangle.south + rectangle.north) * 0.5;
        cartographicScratch.height = 0.0;
        var westernMidpointCartesian = ellipsoid.cartographicToCartesian(cartographicScratch, westernMidpointScratch);

        // Compute the normal of the plane on the western edge of the tile.
        var westNormal = Cartesian3.cross(westernMidpointCartesian, Cartesian3.UNIT_Z, cartesian3Scratch);
        Cartesian3.normalize(westNormal, tileBB.westNormal);

        // The middle latitude on the eastern edge.
        cartographicScratch.longitude = rectangle.east;
        var easternMidpointCartesian = ellipsoid.cartographicToCartesian(cartographicScratch, easternMidpointScratch);

        // Compute the normal of the plane on the eastern edge of the tile.
        var eastNormal = Cartesian3.cross(Cartesian3.UNIT_Z, easternMidpointCartesian, cartesian3Scratch);
        Cartesian3.normalize(eastNormal, tileBB.eastNormal);

        // Compute the normal of the plane bounding the southern edge of the tile.
        var southeastCornerNormal = ellipsoid.geodeticSurfaceNormalCartographic(Rectangle.southeast(rectangle), cartesian3Scratch2);
        var westVector = Cartesian3.subtract(westernMidpointCartesian, easternMidpointCartesian, cartesian3Scratch);
        var southNormal = Cartesian3.cross(southeastCornerNormal, westVector, cartesian3Scratch2);
        Cartesian3.normalize(southNormal, tileBB.southNormal);

        // Compute the normal of the plane bounding the northern edge of the tile.
        var northwestCornerNormal = ellipsoid.geodeticSurfaceNormalCartographic(Rectangle.northwest(rectangle), cartesian3Scratch2);
        var northNormal = Cartesian3.cross(westVector, northwestCornerNormal, cartesian3Scratch2);
        Cartesian3.normalize(northNormal, tileBB.northNormal);
    }

    var southwestCornerScratch = new Cartesian3();
    var northeastCornerScratch = new Cartesian3();
    var negativeUnitY = new Cartesian3(0.0, -1.0, 0.0);
    var negativeUnitZ = new Cartesian3(0.0, 0.0, -1.0);
    var vectorScratch = new Cartesian3();

    TileBoundingRegion.prototype.distanceToCamera = function(frameState) {
        var southwestCornerCartesian = this.southwestCornerCartesian;
        var northeastCornerCartesian = this.northeastCornerCartesian;
        var westNormal = this.westNormal;
        var southNormal = this.southNormal;
        var eastNormal = this.eastNormal;
        var northNormal = this.northNormal;
        var maximumHeight = this.maximumHeight;

        if (frameState.mode !== SceneMode.SCENE3D) {
            southwestCornerCartesian = frameState.mapProjection.project(Rectangle.southwest(this.rectangle), southwestCornerScratch);
            southwestCornerCartesian.z = southwestCornerCartesian.y;
            southwestCornerCartesian.y = southwestCornerCartesian.x;
            southwestCornerCartesian.x = 0.0;
            northeastCornerCartesian = frameState.mapProjection.project(Rectangle.northeast(this.rectangle), northeastCornerScratch);
            northeastCornerCartesian.z = northeastCornerCartesian.y;
            northeastCornerCartesian.y = northeastCornerCartesian.x;
            northeastCornerCartesian.x = 0.0;
            westNormal = negativeUnitY;
            eastNormal = Cartesian3.UNIT_Y;
            southNormal = negativeUnitZ;
            northNormal = Cartesian3.UNIT_Z;
            maximumHeight = 0.0;
        }

        var cameraCartesianPosition = frameState.camera.positionWC;
        var cameraCartographicPosition = frameState.camera.positionCartographic;

        var vectorFromSouthwestCorner = Cartesian3.subtract(cameraCartesianPosition, southwestCornerCartesian, vectorScratch);
        var distanceToWestPlane = Cartesian3.dot(vectorFromSouthwestCorner, westNormal);
        var distanceToSouthPlane = Cartesian3.dot(vectorFromSouthwestCorner, southNormal);

        var vectorFromNortheastCorner = Cartesian3.subtract(cameraCartesianPosition, northeastCornerCartesian, vectorScratch);
        var distanceToEastPlane = Cartesian3.dot(vectorFromNortheastCorner, eastNormal);
        var distanceToNorthPlane = Cartesian3.dot(vectorFromNortheastCorner, northNormal);

        var cameraHeight;
        if (frameState.mode === SceneMode.SCENE3D) {
            cameraHeight = cameraCartographicPosition.height;
        } else {
            cameraHeight = cameraCartesianPosition.x;
        }
        var distanceFromTop = cameraHeight - maximumHeight;

        var result = 0.0;

        if (distanceToWestPlane > 0.0) {
            result += distanceToWestPlane * distanceToWestPlane;
        } else if (distanceToEastPlane > 0.0) {
            result += distanceToEastPlane * distanceToEastPlane;
        }

        if (distanceToSouthPlane > 0.0) {
            result += distanceToSouthPlane * distanceToSouthPlane;
        } else if (distanceToNorthPlane > 0.0) {
            result += distanceToNorthPlane * distanceToNorthPlane;
        }

        if (distanceFromTop > 0.0) {
            result += distanceFromTop * distanceFromTop;
        }

        return Math.sqrt(result);
    };

    /**
     * Determines which side of a plane this box is located.
     *
     * @param {Plane} plane The plane to test against.
     * @returns {Intersect} {@link Intersect.INSIDE} if the entire box is on the side of the plane
     *                      the normal is pointing, {@link Intersect.OUTSIDE} if the entire box is
     *                      on the opposite side, and {@link Intersect.INTERSECTING} if the box
     *                      intersects the plane.
     */
    TileBoundingRegion.prototype.intersectPlane = function(plane) {
        return this._orientedBoundingBox.intersectPlane(plane);
    };

    return TileBoundingRegion;
});
