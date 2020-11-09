import React, { ReactElement, SyntheticEvent } from 'react';
import {
  tree as d3tree,
  select,
  hierarchy,
  zoom as d3zoom,
  event,
  zoomIdentity,
  HierarchyPointNode,
} from 'd3';
import clone from 'clone';
import deepEqual from 'deep-equal';
import uuid from 'uuid';
import TransitionGroupWrapper from './TransitionGroupWrapper';
import Node from '../Node';
import Link from '../Link';
import {
  FIXME,
  Orientation,
  PathFunctionOption,
  PathFunction,
  TreeNodeDatum,
  TreeLink,
  NodeElement,
  PositionCoordinates,
  RawNodeDatum,
} from '../types/common';
import './style.css';

export type TreeNodeEventCallback = (node: TreeNodeDatum, event: SyntheticEvent) => any;
type TreeLinkEventCallback = (
  sourceNode: HierarchyPointNode<TreeNodeDatum>,
  targetNode: HierarchyPointNode<TreeNodeDatum>,
  event: SyntheticEvent
) => any;

export type TreeProps = {
  data: RawNodeDatum[] | RawNodeDatum;
  commonNodeElement?: NodeElement;
  nodeLabelProps?: Record<string, FIXME>;
  nodeLabelComponent?: {
    render: ReactElement;
    foreignObjectWrapper?: Record<string, FIXME>;
  };
  onClick?: TreeNodeEventCallback;
  onMouseOver?: TreeNodeEventCallback;
  onMouseOut?: TreeNodeEventCallback;
  onLinkClick?: TreeLinkEventCallback;
  onLinkMouseOver?: TreeLinkEventCallback;
  onLinkMouseOut?: TreeLinkEventCallback;
  onUpdate?: (target: {
    node: TreeNodeDatum | null;
    zoom: number;
    translate: PositionCoordinates;
  }) => any;
  orientation?: Orientation;
  translate?: PositionCoordinates;
  pathFunc?: PathFunctionOption | PathFunction;
  transitionDuration?: number;
  depthFactor?: number;
  collapsible?: boolean;
  useCollapseData?: boolean;
  initialDepth?: number;
  zoomable?: boolean;
  zoom?: number;
  scaleExtent?: {
    min?: number;
    max?: number;
  };
  nodeSize?: {
    x: number;
    y: number;
  };
  separation?: {
    siblings?: number;
    nonSiblings?: number;
  };
  shouldCollapseNeighborNodes?: boolean;
  allowForeignObjects?: boolean;
  enableLegacyTransitions?: boolean;
};

type TreeState = {
  dataRef: TreeProps['data'];
  data: TreeNodeDatum[];
  d3: { translate: PositionCoordinates; scale: number };
  rd3tSvgClassName: string;
  rd3tGClassName: string;
  isTransitioning: boolean;
};

class Tree extends React.Component<TreeProps, TreeState> {
  state = {
    // eslint-disable-next-line react/no-unused-state
    dataRef: this.props.data,
    data: Tree.assignInternalProperties(clone(this.props.data)),
    d3: Tree.calculateD3Geometry(this.props),
    rd3tSvgClassName: `_${uuid.v4()}`,
    rd3tGClassName: `_${uuid.v4()}`,
    isTransitioning: false,
  };

  private internalState = {
    initialRender: true,
    targetNode: null,
    isTransitioning: false,
  };

  static getDerivedStateFromProps(nextProps: TreeProps, prevState: TreeState) {
    let derivedState = null;
    // Clone new data & assign internal properties if `data` object reference changed.
    if (nextProps.data !== prevState.dataRef) {
      derivedState = {
        // eslint-disable-next-line react/no-unused-state
        dataRef: nextProps.data,
        data: Tree.assignInternalProperties(clone(nextProps.data)),
      };
    }
    const d3 = Tree.calculateD3Geometry(nextProps);
    if (!deepEqual(d3, prevState.d3)) {
      derivedState = derivedState || {};
      derivedState.d3 = d3;
    }
    return derivedState;
  }

  componentDidMount() {
    this.bindZoomListener(this.props);
    this.internalState.initialRender = false;
  }

  componentDidUpdate(prevProps: TreeProps) {
    // If zoom-specific props change -> rebind listener with new values
    // Or: rebind zoom listeners to new DOM nodes in case legacy transitions were enabled/disabled.
    if (
      !deepEqual(this.props.translate, prevProps.translate) ||
      !deepEqual(this.props.scaleExtent, prevProps.scaleExtent) ||
      this.props.zoom !== prevProps.zoom ||
      this.props.enableLegacyTransitions !== prevProps.enableLegacyTransitions
    ) {
      this.bindZoomListener(this.props);
    }
    if (typeof this.props.onUpdate === 'function') {
      this.props.onUpdate({
        node: this.internalState.targetNode ? clone(this.internalState.targetNode) : null,
        zoom: this.state.d3.scale,
        translate: this.state.d3.translate,
      });
    }
    // Reset the last target node after we've flushed it to `onUpdate`.
    this.internalState.targetNode = null;
  }

  /**
   * setInitialTreeDepth - Description
   *
   * @param {array} nodeSet Array of nodes generated by `generateTree`
   * @param {number} initialDepth Maximum initial depth the tree should render
   *
   * @return {void}
   */
  setInitialTreeDepth(nodeSet: HierarchyPointNode<TreeNodeDatum>[], initialDepth: number) {
    nodeSet.forEach(n => {
      n.data._collapsed = n.depth >= initialDepth;
    });
  }

  /**
   * bindZoomListener - If `props.zoomable`, binds a listener for
   * "zoom" events to the SVG and sets scaleExtent to min/max
   * specified in `props.scaleExtent`.
   *
   * @return {void}
   */
  bindZoomListener(props: TreeProps) {
    const { zoomable, scaleExtent, translate, zoom, onUpdate } = props;
    const { rd3tSvgClassName, rd3tGClassName } = this.state;
    const svg = select(`.${rd3tSvgClassName}`);
    const g = select(`.${rd3tGClassName}`);
    if (zoomable) {
      // Sets initial offset, so that first pan and zoom does not jump back to default [0,0] coords.
      svg.call(d3zoom().transform, zoomIdentity.translate(translate.x, translate.y).scale(zoom));
      svg.call(
        d3zoom()
          .scaleExtent([scaleExtent.min, scaleExtent.max])
          // TODO: break this out into a separate zoom handler fn, rather than inlining it.
          .on('zoom', () => {
            g.attr('transform', event.transform);
            if (typeof onUpdate === 'function') {
              // This callback is magically called not only on "zoom", but on "drag", as well,
              // even though event.type == "zoom".
              // Taking advantage of this and not writing a "drag" handler.
              onUpdate({
                node: null,
                zoom: event.transform.k,
                translate: { x: event.transform.x, y: event.transform.y },
              });
              // TODO: remove this? Shouldn't be mutating state keys directly.
              this.state.d3.scale = event.transform.k;
              this.state.d3.translate = {
                x: event.transform.x,
                y: event.transform.y,
              };
            }
          })
      );
    }
  }

  /**
   * assignInternalProperties - Assigns internal properties to each node in the
   * `data` set that are required for tree manipulation and returns
   * a new `data` array.
   *
   * @static
   * @param {array} data Hierarchical tree data
   *
   * @return {array} `data` array with internal properties added
   */
  static assignInternalProperties(data: RawNodeDatum[], currentDepth: number = 0): TreeNodeDatum[] {
    // Wrap the root node into an array for recursive transformations if it wasn't in one already.
    const d = Array.isArray(data) ? data : [data];
    return d.map(n => {
      const node = n as TreeNodeDatum;
      node.id = uuid.v4();
      // D3@v5 compat: manually assign `_depth` to node.data so we don't have to hold full node+link sets in state.
      // TODO: avoid this extra step by checking D3's node.depth directly.
      node._depth = currentDepth;
      // If the node's `_collapsed` state wasn't defined by the data set -> default to `false`.
      if (node._collapsed === undefined) {
        node._collapsed = false;
      }
      // If there are children, recursively assign properties to them too.
      if (node.children && node.children.length > 0) {
        node.children = Tree.assignInternalProperties(node.children, currentDepth + 1);
        node._children = node.children;
      }
      return node;
    });
  }

  /**
   * Recursively walks the nested `nodeSet` until a node matching `nodeId` is found.
   */
  findNodesById(nodeId: string, nodeSet: TreeNodeDatum[], hits: TreeNodeDatum[]) {
    if (hits.length > 0) {
      return hits;
    }
    hits = hits.concat(nodeSet.filter(node => node.id === nodeId));
    nodeSet.forEach(node => {
      if (node._children && node._children.length > 0) {
        hits = this.findNodesById(nodeId, node._children, hits);
      }
    });
    return hits;
  }

  /**
   * Recursively walks the nested `nodeSet` until all nodes at `depth` have been found.
   *
   * @param {number} depth Target depth for which nodes should be returned
   * @param {array} nodeSet Array of nested `node` objects
   * @param {array} accumulator Accumulator for matches, passed between recursive calls
   * @return
   */
  findNodesAtDepth(depth: number, nodeSet: TreeNodeDatum[], accumulator: TreeNodeDatum[]) {
    accumulator = accumulator.concat(nodeSet.filter(node => node._depth === depth));
    nodeSet.forEach(node => {
      if (node._children && node._children.length > 0) {
        accumulator = this.findNodesAtDepth(depth, node._children, accumulator);
      }
    });
    return accumulator;
  }

  /**
   * collapseNode - Recursively sets the `_collapsed` property of
   * the passed `node` object and its children to `true`.
   *
   * @param {Node} node Node object with custom properties
   *
   * @return {void}
   */
  static collapseNode(node: FIXME) {
    node._collapsed = true;
    if (node._children && node._children.length > 0) {
      node._children.forEach(child => {
        Tree.collapseNode(child);
      });
    }
  }

  /**
   * expandNode - Sets the `_collapsed` property of
   * the passed `node` object to `false`.
   *
   * @param {object} node Node object with custom properties
   *
   * @return {void}
   */
  static expandNode(node: FIXME) {
    node._collapsed = false;
  }

  /**
   * collapseNodeNeighbors - Collapses all nodes in `nodeSet` that are neighbors (same depth) of `targetNode`.
   *
   * @param {object} targetNode
   * @param {array} nodeSet
   *
   * @return {void}
   */
  collapseNeighborNodes(targetNode: TreeNodeDatum, nodeSet: TreeNodeDatum[]) {
    const neighbors = this.findNodesAtDepth(targetNode._depth, nodeSet, []).filter(
      node => node.id !== targetNode.id
    );
    neighbors.forEach(neighbor => Tree.collapseNode(neighbor));
  }

  /**
   * handleNodeToggle - Finds the node matching `nodeId` and
   * expands/collapses it, depending on the current state of
   * its `_collapsed` property.
   * `setState` callback receives targetNode and handles
   * `props.onClick` if defined.
   *
   * @param {string} nodeId A node object's `id` field.
   *
   * @param {object} evt Event
   *
   * @return {void}
   */
  handleNodeToggle = (nodeId: string, evt: SyntheticEvent) => {
    const data = clone(this.state.data);
    const matches = this.findNodesById(nodeId, data, []);
    const targetNode = matches[0];
    // Persist the SyntheticEvent for downstream handling by users.
    evt.persist();
    if (this.props.collapsible && !this.state.isTransitioning) {
      if (targetNode._collapsed) {
        Tree.expandNode(targetNode);
        this.props.shouldCollapseNeighborNodes && this.collapseNeighborNodes(targetNode, data);
      } else {
        Tree.collapseNode(targetNode);
      }
      // Lock node toggling while transition takes place
      this.setState({ data, isTransitioning: true }, () => this.handleOnClickCb(targetNode, evt));
      // Await transitionDuration + 10 ms before unlocking node toggling again
      setTimeout(
        () => this.setState({ isTransitioning: false }),
        this.props.transitionDuration + 10
      );
      this.internalState.targetNode = targetNode;
    } else {
      this.handleOnClickCb(targetNode, evt);
    }
  };

  /**
   * handleOnClickCb - Handles the user-defined `onClick` function
   *
   * @param {object} targetNode Description
   *
   * @param {object} evt Event
   *
   * @return {void}
   */
  handleOnClickCb = (targetNode: FIXME, evt: SyntheticEvent) => {
    const { onClick } = this.props;
    if (onClick && typeof onClick === 'function') {
      onClick(clone(targetNode), evt);
    }
  };

  /**
   * handleOnLinkClickCb - Handles the user-defined `onLinkClick` function
   *
   * @param {object} linkSource Description
   *
   * @param {object} linkTarget Description
   *
   *  @param {object} evt Event
   *
   * @return {void}
   */
  handleOnLinkClickCb: TreeLinkEventCallback = (linkSource, linkTarget, evt) => {
    const { onLinkClick } = this.props;
    if (onLinkClick && typeof onLinkClick === 'function') {
      // Persist the SyntheticEvent for downstream handling by users.
      evt.persist();
      onLinkClick(clone(linkSource), clone(linkTarget), evt);
    }
  };

  /**
   * handleOnMouseOverCb - Handles the user-defined `onMouseOver` function
   *
   * @param {string} nodeId
   *
   * @param {object} evt Event
   *
   * @return {void}
   */
  handleOnMouseOverCb = (nodeId: string, evt: SyntheticEvent) => {
    const { onMouseOver } = this.props;
    if (onMouseOver && typeof onMouseOver === 'function') {
      const data = clone(this.state.data);
      const matches = this.findNodesById(nodeId, data, []);
      const targetNode = matches[0];
      // Persist the SyntheticEvent for downstream handling by users.
      evt.persist();
      onMouseOver(clone(targetNode), evt);
    }
  };

  /**
   * handleOnLinkMouseOverCb - Handles the user-defined `onLinkMouseOver` function
   *
   * @param {object} linkSource Description
   *
   * @param {object} linkTarget Description
   *
   * @param {object} evt Event
   *
   * @return {void}
   */
  handleOnLinkMouseOverCb: TreeLinkEventCallback = (linkSource, linkTarget, evt) => {
    const { onLinkMouseOver } = this.props;
    if (onLinkMouseOver && typeof onLinkMouseOver === 'function') {
      // Persist the SyntheticEvent for downstream handling by users.
      evt.persist();
      onLinkMouseOver(clone(linkSource), clone(linkTarget), evt);
    }
  };

  /**
   * handleOnMouseOutCb - Handles the user-defined `onMouseOut` function
   *
   * @param {string} nodeId
   *
   * @param {object} evt Event
   *
   * @return {void}
   */
  handleOnMouseOutCb = (nodeId: string, evt: SyntheticEvent) => {
    const { onMouseOut } = this.props;
    if (onMouseOut && typeof onMouseOut === 'function') {
      const data = clone(this.state.data);
      const matches = this.findNodesById(nodeId, data, []);
      const targetNode = matches[0];
      // Persist the SyntheticEvent for downstream handling by users.
      evt.persist();
      onMouseOut(clone(targetNode), evt);
    }
  };

  /**
   * handleOnLinkMouseOutCb - Handles the user-defined `onLinkMouseOut` function
   *
   * @param {string} linkSource
   *
   * @param {string} linkTarget
   *
   * @param {object} evt Event
   *
   * @return {void}
   */
  handleOnLinkMouseOutCb: TreeLinkEventCallback = (linkSource, linkTarget, evt) => {
    const { onLinkMouseOut } = this.props;
    if (onLinkMouseOut && typeof onLinkMouseOut === 'function') {
      // Persist the SyntheticEvent for downstream handling by users.
      evt.persist();
      onLinkMouseOut(clone(linkSource), clone(linkTarget), evt);
    }
  };

  /**
   * generateTree - Generates tree elements (`nodes` and `links`) by
   * grabbing the rootNode from `this.state.data[0]`.
   * Restricts tree depth to `props.initialDepth` if defined and if this is
   * the initial render of the tree.
   *
   * @return {object} Object containing `nodes` and `links`.
   */
  generateTree() {
    const {
      initialDepth,
      useCollapseData,
      depthFactor,
      separation,
      nodeSize,
      orientation,
    } = this.props;
    const tree = d3tree<TreeNodeDatum>()
      .nodeSize(orientation === 'horizontal' ? [nodeSize.y, nodeSize.x] : [nodeSize.x, nodeSize.y])
      .separation((a, b) =>
        a.parent.data.id === b.parent.data.id ? separation.siblings : separation.nonSiblings
      );

    const rootNode = tree(hierarchy(this.state.data[0], d => (d._collapsed ? null : d._children)));
    let nodes = rootNode.descendants();
    const links = rootNode.links();

    // Set `initialDepth` on first render if specified
    if (
      useCollapseData === false &&
      initialDepth !== undefined &&
      this.internalState.initialRender
    ) {
      // TODO: refactor to avoid mutating input parameter.
      this.setInitialTreeDepth(nodes, initialDepth);
    }

    // TODO: refactor to avoid mutating nodes const.
    if (depthFactor) {
      nodes.forEach(node => {
        node.y = node.depth * depthFactor;
      });
    }

    return { nodes, links };
  }

  /**
   * calculateD3Geometry - Set initial zoom and position.
   * Also limit zoom level according to `scaleExtent` on initial display. This is necessary,
   * because the first time we are setting it as an SVG property, instead of going
   * through D3's scaling mechanism, which would have picked up both properties.
   *
   * @param  {object} nextProps
   * @return {object} {translate: {x: number, y: number}, zoom: number}
   */
  static calculateD3Geometry(nextProps: TreeProps) {
    let scale;
    if (nextProps.zoom > nextProps.scaleExtent.max) {
      scale = nextProps.scaleExtent.max;
    } else if (nextProps.zoom < nextProps.scaleExtent.min) {
      scale = nextProps.scaleExtent.min;
    } else {
      scale = nextProps.zoom;
    }
    return {
      translate: nextProps.translate,
      scale,
    };
  }

  render() {
    const { nodes, links } = this.generateTree();
    const { rd3tSvgClassName, rd3tGClassName } = this.state;
    const {
      commonNodeElement,
      nodeLabelComponent,
      nodeLabelProps,
      orientation,
      pathFunc,
      transitionDuration,
      zoomable,
      nodeSize,
      depthFactor,
      initialDepth,
      separation,
      allowForeignObjects,
      enableLegacyTransitions,
    } = this.props;
    const { translate, scale } = this.state.d3;
    const subscriptions = {
      ...nodeSize,
      ...separation,
      depthFactor,
      initialDepth,
    };

    return (
      <div className={`rd3t-tree-container ${zoomable ? 'rd3t-grabbable' : undefined}`}>
        <svg className={rd3tSvgClassName} width="100%" height="100%">
          <TransitionGroupWrapper
            enableLegacyTransitions={enableLegacyTransitions}
            component="g"
            className={rd3tGClassName}
            transform={`translate(${translate.x},${translate.y}) scale(${scale})`}
          >
            {links.map(linkData => {
              // console.log(linkData);
              return (
                <Link
                  key={uuid.v4()}
                  orientation={orientation}
                  pathFunc={pathFunc}
                  linkData={linkData}
                  onClick={this.handleOnLinkClickCb}
                  onMouseOver={this.handleOnLinkMouseOverCb}
                  onMouseOut={this.handleOnLinkMouseOutCb}
                  enableLegacyTransitions={enableLegacyTransitions}
                  transitionDuration={transitionDuration}
                />
              );
            })}

            {nodes.map(({ data, x, y, parent, ...rest }) => {
              // console.log({ data, x, y, parent, ...rest });
              return (
                <Node
                  key={data.id}
                  data={data}
                  position={{ x, y }}
                  parent={parent}
                  nodeElement={data.nodeElement ? data.nodeElement : commonNodeElement}
                  nodeLabelProps={nodeLabelProps}
                  nodeLabelComponent={nodeLabelComponent}
                  nodeSize={nodeSize}
                  orientation={orientation}
                  enableLegacyTransitions={enableLegacyTransitions}
                  transitionDuration={transitionDuration}
                  onClick={this.handleNodeToggle}
                  onMouseOver={this.handleOnMouseOverCb}
                  onMouseOut={this.handleOnMouseOutCb}
                  subscriptions={subscriptions}
                  allowForeignObjects={allowForeignObjects}
                />
              );
            })}
          </TransitionGroupWrapper>
        </svg>
      </div>
    );
  }
}

// @ts-ignore
Tree.defaultProps = {
  commonNodeElement: {
    tag: 'circle',
    baseProps: {
      r: 10,
    },
  },
  nodeLabelProps: {
    labelNameProps: {
      textAnchor: 'start',
      x: 10,
      y: -10,
      style: { stroke: 'green' },
    },
    labelAttributeProps: {
      x: 10,
      dy: '1.2em',
      style: { stroke: 'purple' },
    },
  },
  nodeLabelComponent: null,
  onClick: undefined,
  onMouseOver: undefined,
  onMouseOut: undefined,
  onLinkClick: undefined,
  onLinkMouseOver: undefined,
  onLinkMouseOut: undefined,
  onUpdate: undefined,
  orientation: 'horizontal',
  translate: { x: 0, y: 0 },
  pathFunc: 'diagonal',
  transitionDuration: 500,
  depthFactor: undefined,
  collapsible: true,
  useCollapseData: false,
  initialDepth: undefined,
  zoomable: true,
  zoom: 1,
  scaleExtent: { min: 0.1, max: 1 },
  nodeSize: { x: 140, y: 140 },
  separation: { siblings: 1, nonSiblings: 2 },
  textLayout: {
    textAnchor: 'start',
    x: 10,
    y: -10,
    transform: undefined,
  },
  shouldCollapseNeighborNodes: false,
  styles: {},
  allowForeignObjects: false,
  enableLegacyTransitions: false,
};

export default Tree;
