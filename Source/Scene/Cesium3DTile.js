/*global define*/
define([
        '../Core/BoundingSphere',
        '../Core/BoxOutlineGeometry',
        '../Core/Cartesian3',
        '../Core/Color',
        '../Core/ColorGeometryInstanceAttribute',
        '../Core/clone',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/destroyObject',
        '../Core/DeveloperError',
        '../Core/GeometryInstance',
        '../Core/getExtensionFromUri',
        '../Core/getMagic',
        '../Core/getStringFromTypedArray',
        '../Core/Intersect',
        '../Core/joinUrls',
        '../Core/JulianDate',
        '../Core/loadArrayBuffer',
        '../Core/Matrix3',
        '../Core/Matrix4',
        '../Core/Rectangle',
        '../Core/RectangleOutlineGeometry',
        '../Core/Request',
        '../Core/RequestType',
        '../Core/SphereOutlineGeometry',
        '../ThirdParty/Uri',
        '../ThirdParty/when',
        './Cesium3DTileChildrenVisibility',
        './Cesium3DTileContentFactory',
        './Cesium3DTileContentState',
        './Cesium3DTileOptimizations',
        './Cesium3DTileOptimizationHint',
        './Cesium3DTileRefine',
        './Empty3DTileContent',
        './PerInstanceColorAppearance',
        './Primitive',
        './SceneMode',
        './TileBoundingRegion',
        './TileBoundingSphere',
        './TileOrientedBoundingBox'
    ], function(
        BoundingSphere,
        BoxOutlineGeometry,
        Cartesian3,
        Color,
        ColorGeometryInstanceAttribute,
        clone,
        defaultValue,
        defined,
        defineProperties,
        destroyObject,
        DeveloperError,
        GeometryInstance,
        getExtensionFromUri,
        getMagic,
        getStringFromTypedArray,
        Intersect,
        joinUrls,
        JulianDate,
        loadArrayBuffer,
        Matrix3,
        Matrix4,
        Rectangle,
        RectangleOutlineGeometry,
        Request,
        RequestType,
        SphereOutlineGeometry,
        Uri,
        when,
        Cesium3DTileChildrenVisibility,
        Cesium3DTileContentFactory,
        Cesium3DTileContentState,
        Cesium3DTileOptimizations,
        Cesium3DTileOptimizationHint,
        Cesium3DTileRefine,
        Empty3DTileContent,
        PerInstanceColorAppearance,
        Primitive,
        SceneMode,
        TileBoundingRegion,
        TileBoundingSphere,
        TileOrientedBoundingBox) {
    'use strict';

    /**
     * A tile in a 3D Tiles tileset.  When a tile is first created, its content is not loaded;
     * the content is loaded on-demand when needed based on the view using
     * {@link Cesium3DTile#requestContent}.
     * <p>
     * Do not construct this directly, instead access tiles through {@link Cesium3DTileset#tileVisible}.
     * </p>
     *
     * @alias Cesium3DTile
     * @constructor
     */
    function Cesium3DTile(tileset, baseUrl, header, parent) {
        this._tileset = tileset;
        this._header = header;
        var contentHeader = header.content;

        /**
         * The local transform of this tile
         * @type {Matrix4}
         */
        this.transform = defined(header.transform) ? Matrix4.unpack(header.transform) : Matrix4.clone(Matrix4.IDENTITY);

        var parentTransform = defined(parent) ? parent.computedTransform : tileset.modelMatrix;
        var computedTransform = Matrix4.multiply(parentTransform, this.transform, new Matrix4());

        /**
         * The final computed transform of this tile
         * @type {Matrix4}
         */
        this.computedTransform = computedTransform;

        this._boundingVolume = this.createBoundingVolume(header.boundingVolume, computedTransform);
        this._boundingVolume2D = undefined;

        var contentBoundingVolume;

        if (defined(contentHeader) && defined(contentHeader.boundingVolume)) {
            // Non-leaf tiles may have a content bounding-volume, which is a tight-fit bounding volume
            // around only the models in the tile.  This box is useful for culling for rendering,
            // but not for culling for traversing the tree since it does not guarantee spatial coherence, i.e.,
            // since it only bounds models in the tile, not the entire tile, children may be
            // outside of this box.
            contentBoundingVolume = this.createBoundingVolume(contentHeader.boundingVolume, computedTransform);
        }
        this._contentBoundingVolume = contentBoundingVolume;
        this._contentBoundingVolume2D = undefined;

        var viewerRequestVolume;
        if (defined(header.viewerRequestVolume)) {
            viewerRequestVolume = this.createBoundingVolume(header.viewerRequestVolume, computedTransform);
        }
        this._viewerRequestVolume = viewerRequestVolume;

        /**
         * The error, in meters, introduced if this tile is rendered and its children are not.
         * This is used to compute Screen-Space Error (SSE), i.e., the error measured in pixels.
         *
         * @type {Number}
         * @readonly
         */
        this.geometricError = header.geometricError;

        var refine;
        if (defined(header.refine)) {
            refine = (header.refine === 'replace') ? Cesium3DTileRefine.REPLACE : Cesium3DTileRefine.ADD;
        } else if (defined(parent)) {
            // Inherit from parent tile if omitted.
            refine = parent.refine;
        } else {
            refine = Cesium3DTileRefine.REPLACE;
        }

        /**
         * Specifies if additive or replacement refinement is used when traversing this tile for rendering.
         *
         * @type {Cesium3DTileRefine}
         * @readonly
         */
        this.refine = refine;

        /**
         * An array of {@link Cesium3DTile} objects that are this tile's children.
         *
         * @type {Array}
         * @readonly
         */
        this.children = [];

        /**
         * This tile's parent or <code>undefined</code> if this tile is the root.
         * <p>
         * When a tile's content points to an external tileset.json, the external tileset's
         * root tile's parent is not <code>undefined</code>; instead, the parent references
         * the tile (with its content pointing to an external tileset.json) as if the two tilesets were merged.
         * </p>
         *
         * @type {Cesium3DTile}
         * @readonly
         */
        this.parent = parent;

        var content;
        var hasEmptyContent;
        var contentState;
        var contentUrl;

        if (defined(contentHeader)) {
            hasEmptyContent = false;
            contentState = Cesium3DTileContentState.UNLOADED;
            contentUrl = joinUrls(baseUrl, contentHeader.url);
        } else {
            content = new Empty3DTileContent(tileset, this);
            hasEmptyContent = true;
            contentState = Cesium3DTileContentState.READY;
        }

        this._content = content;
        this._contentUrl = contentUrl;
        this._contentState = contentState;
        this._contentReadyToProcessPromise = undefined;
        this._contentReadyPromise = undefined;
        this._expiredContent = undefined;

        /**
         * When <code>true</code>, the tile has no content.
         *
         * @type {Boolean}
         * @readonly
         *
         * @private
         */
        this.hasEmptyContent = hasEmptyContent;

        /**
         * When <code>true</code>, the tile's content is renderable.
         * <p>
         * This is <code>false</code> until the tile's content is loaded.
         * </p>
         *
         * @type {Boolean}
         * @readonly
         *
         * @private
         */
        this.hasRenderableContent = false;

        /**
         * When <code>true</code>, the tile's content points to an external tileset.
         * <p>
         * This is <code>false</code> until the tile's content is loaded.
         * </p>
         *
         * @type {Boolean}
         * @readonly
         *
         * @private
         */
        this.hasTilesetContent = false;

        /**
         * The corresponding node in the cache replacement list.
         *
         * @type {DoublyLinkedListNode}
         * @readonly
         *
         * @private
         */
        this.replacementNode = undefined;

        var expire = header.expire;
        var expireDuration;
        var expireDate;
        if (defined(expire)) {
            expireDuration = expire.duration;
            if (defined(expire.date)) {
                expireDate = JulianDate.fromIso8601(expire.date);
            }
        }

        /**
         * The time in seconds after the tile's content is ready when the content expires and new content is requested.
         *
         * @type {Number}
         */
        this.expireDuration = expireDuration;

        /**
         * The date when the content expires and new content is requested.
         *
         * @type {JulianDate}
         */
        this.expireDate = expireDate;

        /**
         * Marks if the tile is selected this frame.
         *
         * @type {Boolean}
         *
         * @private
         */
        this.selected = false;


        /**
         * The time when a style was last applied to this tile.
         *
         * @type {Number}
         *
         * @private
         */
        this.lastStyleTime = 0;

        /**
         * Marks whether the tile's children bounds are fully contained within the tile's bounds
         *
         * @type {Cesium3DTileOptimizationHint}
         *
         * @private
         */
        this._optimChildrenWithinParent = Cesium3DTileOptimizationHint.NOT_COMPUTED;

        // Members that are updated every frame for tree traversal and rendering optimizations:
        this._distanceToCamera = 0;
        this._visibilityPlaneMask = 0;
        this._childrenVisibility = Cesium3DTileChildrenVisibility.VISIBLE;
        this._lastSelectedFrameNumber = -1;
        this._screenSpaceError = 0;
        this._screenSpaceErrorComputedFrame = -1;
        this._finalResolution = true;
        this._requestHeap = undefined;
        this._depth = 0;
        this._centerZDepth = 0;
        this._stackLength = 0;
        this._selectedFrame = -1;
        this._selectionDepth = 0;
        this._lastSelectionDepth = undefined;
        this._requestedFrame = undefined;
        this._lastVisitedFrame = undefined;
        this._ancestorWithContent = undefined;
        this._ancestorWithLoadedContent = undefined;

        this._debugBoundingVolume = undefined;
        this._debugContentBoundingVolume = undefined;
        this._debugViewerRequestVolume = undefined;
        this._debugColor = new Color.fromRandom({ alpha : 1.0 });
        this._debugColorizeTiles = false;

        this._commandsLength = 0;
    }

    defineProperties(Cesium3DTile.prototype, {
        /**
         * The tileset containing this tile.
         *
         * @memberof Cesium3DTile.prototype
         *
         * @type {Cesium3DTileset}
         * @readonly
         */
        tileset : {
            get : function() {
                return this._tileset;
            }
        },

        /**
         * The tile's content.  This represents the actual tile's payload,
         * not the content's metadata in tileset.json.
         *
         * @memberof Cesium3DTile.prototype
         *
         * @type {Cesium3DTileContent}
         * @readonly
         */
        content : {
            get : function() {
                return this._content;
            }
        },

        /**
         * Get the bounding volume of the tile's contents.  This defaults to the
         * tile's bounding volume when the content's bounding volume is
         * <code>undefined</code>.
         *
         * @memberof Cesium3DTile.prototype
         *
         * @type {TileBoundingVolume}
         * @readonly
         */
        contentBoundingVolume : {
            get : function() {
                return defaultValue(this._contentBoundingVolume, this._boundingVolume);
            }
        },

        /**
         * Get the bounding sphere derived from the tile's bounding volume.
         *
         * @memberof Cesium3DTile.prototype
         *
         * @type {BoundingSphere}
         * @readonly
         */
        boundingSphere : {
            get : function() {
                return this._boundingVolume.boundingSphere;
            }
        },

        /**
         * Determines if the tile has available content to render.  <code>true</code> if the tile's
         * content is ready or if it has expired content that renders while new content loads; otherwise,
         * <code>false</code>.
         *
         * @memberof Cesium3DTile.prototype
         *
         * @type {Boolean}
         * @readonly
         */
        contentAvailable : {
            get : function() {
                return this.contentReady || (defined(this._expiredContent) && this._contentState !== Cesium3DTileContentState.FAILED);
            }
        },

        /**
         * Determines if the tile is ready to render. <code>true</code> if the tile
         * is ready to render; otherwise, <code>false</code>.
         *
         * @memberof Cesium3DTile.prototype
         *
         * @type {Boolean}
         * @readonly
         */
        contentReady : {
            get : function() {
                return this._contentState === Cesium3DTileContentState.READY;
            }
        },

        /**
         * Determines if the tile's content has not be requested. <code>true</code> if tile's
         * content has not be requested; otherwise, <code>false</code>.
         *
         * @memberof Cesium3DTile.prototype
         *
         * @type {Boolean}
         * @readonly
         */
        contentUnloaded : {
            get : function() {
                return this._contentState === Cesium3DTileContentState.UNLOADED;
            }
        },

        /**
         * Determines if the tile's content is expired. <code>true</code> if tile's
         * content is expired; otherwise, <code>false</code>.
         *
         * @memberof Cesium3DTile.prototype
         *
         * @type {Boolean}
         * @readonly
         */
        contentExpired : {
            get : function() {
                return this._contentState === Cesium3DTileContentState.EXPIRED;
            }
        },

        /**
         * Gets the promise that will be resolved when the tile's content is ready to process.
         * This happens after the content is downloaded but before the content is ready
         * to render.
         * <p>
         * The promise remains <code>undefined</code> until the tile's content is requested.
         * </p>
         *
         * @type {Promise.<Cesium3DTileContent>}
         * @readonly
         *
         * @private
         */
        contentReadyToProcessPromise : {
            get : function() {
                if (defined(this._contentReadyToProcessPromise)) {
                    return this._contentReadyToProcessPromise.promise;
                }
            }
        },

        /**
         * Gets the promise that will be resolved when the tile's content is ready to render.
         * <p>
         * The promise remains <code>undefined</code> until the tile's content is requested.
         * </p>
         *
         * @type {Promise.<Cesium3DTileContent>}
         * @readonly
         *
         * @private
         */
        contentReadyPromise : {
            get : function() {
                if (defined(this._contentReadyPromise)) {
                    return this._contentReadyPromise.promise;
                }
            }
        },

        /**
         * Returns the number of draw commands used by this tile.
         *
         * @readonly
         *
         * @private
         */
        commandsLength : {
            get : function() {
                return this._commandsLength;
            }
        }
    });

    var scratchJulianDate = new JulianDate();

    /**
     * Update whether the tile has expired.
     *
     * @private
     */
    Cesium3DTile.prototype.updateExpiration = function() {
        if (defined(this.expireDate) && this.contentReady && !this.hasEmptyContent) {
            var now = JulianDate.now(scratchJulianDate);
            if (JulianDate.lessThan(this.expireDate, now)) {
                this._contentState = Cesium3DTileContentState.EXPIRED;
                this._expiredContent = this._content;
            }
        }
    };

    function updateExpireDate(tile) {
        if (defined(tile.expireDuration)) {
            var expireDurationDate = JulianDate.now(scratchJulianDate);
            JulianDate.addSeconds(expireDurationDate, tile.expireDuration, expireDurationDate);

            if (defined(tile.expireDate)) {
                if (JulianDate.lessThan(tile.expireDate, expireDurationDate)) {
                    JulianDate.clone(expireDurationDate, tile.expireDate);
                }
            } else {
                tile.expireDate = JulianDate.clone(expireDurationDate);
            }
        }
    }

    /**
     * Requests the tile's content.
     * <p>
     * The request may not be made if the Cesium Request Scheduler can't prioritize it.
     * </p>
     *
     * @private
     */
    Cesium3DTile.prototype.requestContent = function() {
        var that = this;

        if (this.hasEmptyContent) {
            return false;
        }

        var url = this._contentUrl;
        if (defined(this.expireDate)) {
            // Append a query parameter of the tile expiration date to prevent caching
            var timestampQuery = '?expired=' + this.expireDate.toString();
            url = joinUrls(url, timestampQuery, false);
        }

        var distance = this._distanceToCamera;
        var request = new Request({
            distance : distance,
            type : RequestType.TILES3D,
            throttle : true
        });
        var promise = loadArrayBuffer(url, undefined, request);

        if (!defined(promise)) {
            return false;
        }

        this._contentState = Cesium3DTileContentState.LOADING;
        this._contentReadyToProcessPromise = when.defer();
        this._contentReadyPromise = when.defer();

        promise.then(function(arrayBuffer) {
            if (that.isDestroyed()) {
                // Tile is unloaded before the content finishes loading
                return when.reject('tile is destroyed');
            }
            var uint8Array = new Uint8Array(arrayBuffer);
            var magic = getMagic(uint8Array);
            var contentFactory = Cesium3DTileContentFactory[magic];
            var content;

            if (defined(contentFactory)) {
                content = contentFactory(that._tileset, that, that._contentUrl, arrayBuffer, 0);
                that.hasRenderableContent = true;
            } else {
                // The content may be json instead
                content = Cesium3DTileContentFactory.json(that._tileset, that, that._contentUrl, arrayBuffer, 0);
                that.hasTilesetContent = true;
            }

            that._content = content;
            that._contentState = Cesium3DTileContentState.PROCESSING;
            that._contentReadyToProcessPromise.resolve(content);

            content.readyPromise.then(function(content) {
                if (that.isDestroyed()) {
                    // Tile is unloaded before the content finishes processing
                    return when.reject('tile is destroyed');
                }
                updateExpireDate(that);

                // Refresh style for expired content
                that.lastStyleTime = 0;

                that._contentState = Cesium3DTileContentState.READY;
                that._contentReadyPromise.resolve(content);
            }).otherwise(function(error) {
                that._contentState = Cesium3DTileContentState.FAILED;
                that._contentReadyPromise.reject(error);
            });
        }).otherwise(function(error) {
            that._contentState = Cesium3DTileContentState.FAILED;
            that._contentReadyPromise.reject(error);
            that._contentReadyToProcessPromise.reject(error);
        });

        return true;
    };

    /**
     * Unloads the tile's content and returns the tile's state to the state of when
     * it was first created, before its content was loaded.
     *
     * @private
     */
    Cesium3DTile.prototype.unloadContent = function() {
        if (!this.hasRenderableContent) {
            return;
        }

        this._content = this._content && this._content.destroy();
        this._contentState = Cesium3DTileContentState.UNLOADED;
        this._contentReadyToProcessPromise = undefined;
        this._contentReadyPromise = undefined;

        this.replacementNode = undefined;

        this.lastStyleTime = 0;

        this._debugColorizeTiles = false;

        this._debugBoundingVolume = this._debugBoundingVolume && this._debugBoundingVolume.destroy();
        this._debugContentBoundingVolume = this._debugContentBoundingVolume && this._debugContentBoundingVolume.destroy();
        this._debugViewerRequestVolume = this._debugViewerRequestVolume && this._debugViewerRequestVolume.destroy();
    };

    var scratchProjectedBoundingSphere = new BoundingSphere();

    function getBoundingVolume(tile, frameState) {
        if (frameState.mode !== SceneMode.SCENE3D && !defined(tile._boundingVolume2D)) {
            var boundingSphere = tile._boundingVolume.boundingSphere;
            var sphere = BoundingSphere.projectTo2D(boundingSphere, frameState.mapProjection, scratchProjectedBoundingSphere);
            tile._boundingVolume2D = new TileBoundingSphere(sphere.center, sphere.radius);
        }

        return frameState.mode !== SceneMode.SCENE3D ? tile._boundingVolume2D : tile._boundingVolume;
    }

    function getContentBoundingVolume(tile, frameState) {
        if (frameState.mode !== SceneMode.SCENE3D && !defined(tile._contentBoundingVolume2D)) {
            var boundingSphere = tile._contentBoundingVolume.boundingSphere;
            var sphere = BoundingSphere.projectTo2D(boundingSphere, frameState.mapProjection, scratchProjectedBoundingSphere);
            tile._contentBoundingVolume2D = new TileBoundingSphere(sphere.center, sphere.radius);
        }
        return frameState.mode !== SceneMode.SCENE3D ? tile._contentBoundingVolume2D : tile._contentBoundingVolume;
    }

    /**
     * Determines whether the tile's bounding volume intersects the culling volume.
     *
     * @param {FrameState} frameState The frame state.
     * @param {Number} parentVisibilityPlaneMask The parent's plane mask to speed up the visibility check.
     * @returns {Number} A plane mask as described above in {@link CullingVolume#computeVisibilityWithPlaneMask}.
     *
     * @private
     */
    Cesium3DTile.prototype.visibility = function(frameState, parentVisibilityPlaneMask) {
        var cullingVolume = frameState.cullingVolume;
        var boundingVolume = getBoundingVolume(this, frameState);
        return cullingVolume.computeVisibilityWithPlaneMask(boundingVolume, parentVisibilityPlaneMask);
    };

    /**
     * Assuming the tile's bounding volume intersects the culling volume, determines
     * whether the tile's content's bounding volume intersects the culling volume.
     *
     * @param {FrameState} frameState The frame state.
     * @returns {Intersect} The result of the intersection: the tile's content is completely outside, completely inside, or intersecting the culling volume.
     *
     * @private
     */
    Cesium3DTile.prototype.contentVisibility = function(frameState) {
        // Assumes the tile's bounding volume intersects the culling volume already, so
        // just return Intersect.INSIDE if there is no content bounding volume.
        if (!defined(this._contentBoundingVolume)) {
            return Intersect.INSIDE;
        }

        // PERFORMANCE_IDEA: is it possible to burn less CPU on this test since we know the
        // tile's (not the content's) bounding volume intersects the culling volume?
        var cullingVolume = frameState.cullingVolume;
        var boundingVolume = getContentBoundingVolume(this, frameState);
        return cullingVolume.computeVisibility(boundingVolume);
    };

    /**
     * Computes the (potentially approximate) distance from the closest point of the tile's bounding volume to the camera.
     *
     * @param {FrameState} frameState The frame state.
     * @returns {Number} The distance, in meters, or zero if the camera is inside the bounding volume.
     *
     * @private
     */
    Cesium3DTile.prototype.distanceToTile = function(frameState) {
        var boundingVolume = getBoundingVolume(this, frameState);
        return boundingVolume.distanceToCamera(frameState);
    };

    var scratchCartesian = new Cartesian3();

    /**
     * Computes the distance from the center of the tile's bounding volume to the camera.
     *
     * @param {FrameState} frameState The frame state.
     * @returns {Number} The distance, in meters, or zero if the camera is inside the bounding volume.
     *
     * @private
     */
    Cesium3DTile.prototype.distanceToTileCenter = function(frameState) {
        var boundingVolume = getBoundingVolume(this, frameState).boundingVolume;
        var toCenter = Cartesian3.subtract(boundingVolume.center, frameState.camera.positionWC, scratchCartesian);
        var distance = Cartesian3.magnitude(toCenter);
        Cartesian3.divideByScalar(toCenter, distance, toCenter);
        var dot = Cartesian3.dot(frameState.camera.directionWC, toCenter);
        return distance * dot;
    };

    /**
     * Checks if the camera is inside the viewer request volume.
     *
     * @param {FrameState} frameState The frame state.
     * @returns {Boolean} Whether the camera is inside the volume.
     *
     * @private
     */
    Cesium3DTile.prototype.insideViewerRequestVolume = function(frameState) {
        var viewerRequestVolume = this._viewerRequestVolume;
        if (!defined(viewerRequestVolume)) {
            return true;
        }

        return (viewerRequestVolume.distanceToCamera(frameState) === 0.0);
    };

    var scratchMatrix = new Matrix3();
    var scratchScale = new Cartesian3();
    var scratchHalfAxes = new Matrix3();
    var scratchCenter = new Cartesian3();
    var scratchRectangle = new Rectangle();

    /**
     * Create a bounding volume from the tile's bounding volume header.
     *
     * @param {Object} boundingVolumeHeader The tile's bounding volume header.
     * @param {Matrix4} transform The transform to apply to the bounding volume.
     * @param {TileBoundingVolume} [result] The object onto which to store the result.
     *
     * @returns {TileBoundingVolume} The modified result parameter or a new TileBoundingVolume instance if none was provided.
     *
     * @private
     */
    Cesium3DTile.prototype.createBoundingVolume = function(boundingVolumeHeader, transform, result) {
        var center;
        if (defined(boundingVolumeHeader.box)) {
            var box = boundingVolumeHeader.box;
            center = Cartesian3.fromElements(box[0], box[1], box[2], scratchCenter);
            var halfAxes = Matrix3.fromArray(box, 3, scratchHalfAxes);

            // Find the transformed center and halfAxes
            center = Matrix4.multiplyByPoint(transform, center, center);
            var rotationScale = Matrix4.getRotation(transform, scratchMatrix);
            halfAxes = Matrix3.multiply(rotationScale, halfAxes, halfAxes);

            if (defined(result)) {
                result.update(center, halfAxes);
                return result;
            }
            return new TileOrientedBoundingBox(center, halfAxes);
        } else if (defined(boundingVolumeHeader.region)) {
            var region = boundingVolumeHeader.region;
            var rectangleRegion = Rectangle.unpack(region, 0, scratchRectangle);

            if (defined(result)) {
                // Don't update regions when the transform changes
                return result;
            }
            return new TileBoundingRegion({
                rectangle : rectangleRegion,
                minimumHeight : region[4],
                maximumHeight : region[5]
            });
        } else if (defined(boundingVolumeHeader.sphere)) {
            var sphere = boundingVolumeHeader.sphere;
            center = Cartesian3.fromElements(sphere[0], sphere[1], sphere[2], scratchCenter);
            var radius = sphere[3];

            // Find the transformed center and radius
            center = Matrix4.multiplyByPoint(transform, center, center);
            var scale = Matrix4.getScale(transform, scratchScale);
            var uniformScale = Cartesian3.maximumComponent(scale);
            radius *= uniformScale;

            if (defined(result)) {
                result.update(center, radius);
                return result;
            }
            return new TileBoundingSphere(center, radius);
        }
    };

    var scratchTransform = new Matrix4();

    /**
     * Update the tile's transform. The transform is applied to the tile's bounding volumes.
     *
     * @private
     */
    Cesium3DTile.prototype.updateTransform = function(parentTransform) {
        parentTransform = defaultValue(parentTransform, Matrix4.IDENTITY);
        var computedTransform = Matrix4.multiply(parentTransform, this.transform, scratchTransform);
        var transformChanged = !Matrix4.equals(computedTransform, this.computedTransform);
        if (transformChanged) {
            Matrix4.clone(computedTransform, this.computedTransform);

            // Update the bounding volumes
            var header = this._header;
            var content = this._header.content;
            this._boundingVolume = this.createBoundingVolume(header.boundingVolume, computedTransform, this._boundingVolume);
            if (defined(this._contentBoundingVolume)) {
                this._contentBoundingVolume = this.createBoundingVolume(content.boundingVolume, computedTransform, this._contentBoundingVolume);
            }
            if (defined(this._viewerRequestVolume)) {
                this._viewerRequestVolume = this.createBoundingVolume(header.viewerRequestVolume, computedTransform, this._viewerRequestVolume);
            }

            // Destroy the debug bounding volumes. They will be generated fresh.
            this._debugBoundingVolume = this._debugBoundingVolume && this._debugBoundingVolume.destroy();
            this._debugContentBoundingVolume = this._debugContentBoundingVolume && this._debugContentBoundingVolume.destroy();
            this._debugViewerRequestVolume = this._debugViewerRequestVolume && this._debugViewerRequestVolume.destroy();
        }
    };

    function applyDebugSettings(tile, tileset, frameState) {
        var hasContentBoundingVolume = defined(tile._header.content) && defined(tile._header.content.boundingVolume);

        var showVolume = tileset.debugShowBoundingVolume || (tileset.debugShowContentBoundingVolume && !hasContentBoundingVolume);
        if (showVolume) {
            if (!defined(tile._debugBoundingVolume)) {
                var color = tile._finalResolution ? (hasContentBoundingVolume ? Color.WHITE : Color.RED) : Color.YELLOW;
                tile._debugBoundingVolume = tile._boundingVolume.createDebugVolume(color);
            }
            tile._debugBoundingVolume.update(frameState);
        } else if (!showVolume && defined(tile._debugBoundingVolume)) {
            tile._debugBoundingVolume = tile._debugBoundingVolume.destroy();
        }

        if (tileset.debugShowContentBoundingVolume && hasContentBoundingVolume) {
            if (!defined(tile._debugContentBoundingVolume)) {
                tile._debugContentBoundingVolume = tile._contentBoundingVolume.createDebugVolume(Color.BLUE);
            }
            tile._debugContentBoundingVolume.update(frameState);
        } else if (!tileset.debugShowContentBoundingVolume && defined(tile._debugContentBoundingVolume)) {
            tile._debugContentBoundingVolume = tile._debugContentBoundingVolume.destroy();
        }

        if (tileset.debugShowViewerRequestVolume && defined(tile._viewerRequestVolume)) {
            if (!defined(tile._debugViewerRequestVolume)) {
                tile._debugViewerRequestVolume = tile._viewerRequestVolume.createDebugVolume(Color.YELLOW);
            }
            tile._debugViewerRequestVolume.update(frameState);
        } else if (!tileset.debugShowViewerRequestVolume && defined(tile._debugViewerRequestVolume)) {
            tile._debugViewerRequestVolume = tile._debugViewerRequestVolume.destroy();
        }

        if (tileset.debugColorizeTiles && !tile._debugColorizeTiles) {
            tile._debugColorizeTiles = true;
            tile._content.applyDebugSettings(true, tile._debugColor);
        } else if (!tileset.debugColorizeTiles && tile._debugColorizeTiles) {
            tile._debugColorizeTiles = false;
            tile._content.applyDebugSettings(false, tile._debugColor);
            tileset.makeStyleDirty(); //Re-apply style now that colorize is switched off
        }
    }

    function updateContent(tile, tileset, frameState) {
        var content = tile._content;
        var expiredContent = tile._expiredContent;

        if (defined(expiredContent) && !tile.contentReady) {
            // Render the expired content while the content loads
            expiredContent.update(tileset, frameState);
            return;
        }

        tile._expiredContent = tile._expiredContent && tile._expiredContent.destroy();
        content.update(tileset, frameState);
    }

    /**
     * Get the draw commands needed to render this tile.
     *
     * @private
     */
    Cesium3DTile.prototype.update = function(tileset, frameState) {
        var initCommandLength = frameState.commandList.length;
        applyDebugSettings(this, tileset, frameState);
        updateContent(this, tileset, frameState);
        this._commandsLength = frameState.commandList.length - initCommandLength;
    };

    var scratchCommandList = [];

    /**
     * Processes the tile's content, e.g., create WebGL resources, to move from the PROCESSING to READY state.
     *
     * @param {Cesium3DTileset} tileset The tileset containing this tile.
     * @param {FrameState} frameState The frame state.
     *
     * @private
     */
    Cesium3DTile.prototype.process = function(tileset, frameState) {
        var savedCommandList = frameState.commandList;
        frameState.commandList = scratchCommandList;

        this._content.update(tileset, frameState);

        scratchCommandList.length = 0;
        frameState.commandList = savedCommandList;
    };

    /**
     * @private
     */
    Cesium3DTile.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * @private
     */
    Cesium3DTile.prototype.destroy = function() {
        // For the interval between new content being requested and downloaded, expiredContent === content, so don't destroy twice
        this._content = this._content && this._content.destroy();
        this._expiredContent = this._expiredContent && !this._expiredContent.isDestroyed() && this._expiredContent.destroy();
        this._debugBoundingVolume = this._debugBoundingVolume && this._debugBoundingVolume.destroy();
        this._debugContentBoundingVolume = this._debugContentBoundingVolume && this._debugContentBoundingVolume.destroy();
        this._debugViewerRequestVolume = this._debugViewerRequestVolume && this._debugViewerRequestVolume.destroy();
        return destroyObject(this);
    };

    return Cesium3DTile;
});
