/**
 * Copyright 2018-present Facebook.
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 * @format
 */

import type {ElementID, Element, ElementSearchResultSet} from 'sonar';
import {
  colors,
  Glyph,
  FlexRow,
  FlexColumn,
  Toolbar,
  SonarPlugin,
  ElementsInspector,
  InspectorSidebar,
  LoadingIndicator,
  styled,
  Component,
  SearchBox,
  SearchInput,
  SearchIcon,
  SonarSidebar,
  VerticalRule,
} from 'sonar';

import {
  AXElementsInspector,
  AXToggleButtonEnabled,
} from '../../fb-stubs/AXLayoutExtender.js';

// $FlowFixMe
import debounce from 'lodash.debounce';

export type InspectorState = {|
  initialised: boolean,
  selected: ?ElementID,
  root: ?ElementID,
  elements: {[key: ElementID]: Element},
  isSearchActive: boolean,
  searchResults: ?ElementSearchResultSet,
  outstandingSearchQuery: ?string,
  // properties for ax mode
  AXinitialised: boolean,
  AXselected: ?ElementID,
  AXfocused: ?ElementID,
  AXroot: ?ElementID,
  AXelements: {[key: ElementID]: Element},
  inAXMode: boolean,
  AXtoNonAXMapping: {[key: ElementID]: ElementID},
  isAlignmentMode: boolean,
|};

type SelectElementArgs = {|
  key: ElementID,
  AXkey: ElementID,
|};

type ExpandElementArgs = {|
  key: ElementID,
  expand: boolean,
|};

type ExpandElementsArgs = {|
  elements: Array<ElementID>,
|};

type UpdateElementsArgs = {|
  elements: Array<$Shape<Element>>,
|};

type UpdateAXElementsArgs = {|
  elements: Array<$Shape<Element>>,
  forFocusEvent: boolean,
|};

type AXFocusEventResult = {|
  isFocus: boolean,
|};

type SetRootArgs = {|
  root: ElementID,
|};

type GetNodesResult = {|
  elements: Array<Element>,
|};

type GetNodesOptions = {|
  force: boolean,
  ax: boolean,
  forFocusEvent?: boolean,
|};

type SearchResultTree = {|
  id: string,
  isMatch: Boolean,
  children: ?Array<SearchResultTree>,
  element: Element,
|};

const LoadingSpinner = LoadingIndicator.extends({
  marginRight: 4,
  marginLeft: 3,
  marginTop: -1,
});

const Center = FlexRow.extends({
  alignItems: 'center',
  justifyContent: 'center',
});

const SearchIconContainer = styled.view({
  marginRight: 9,
  marginTop: -3,
  marginLeft: 4,
});

class LayoutSearchInput extends Component<
  {
    onSubmit: string => void,
  },
  {
    value: string,
  },
> {
  static TextInput = styled.textInput({
    width: '100%',
    marginLeft: 6,
  });

  state = {
    value: '',
  };

  timer: TimeoutID;

  onChange = (e: SyntheticInputEvent<>) => {
    clearTimeout(this.timer);
    this.setState({
      value: e.target.value,
    });
    this.timer = setTimeout(() => this.props.onSubmit(this.state.value), 200);
  };

  onKeyDown = (e: SyntheticKeyboardEvent<>) => {
    if (e.key === 'Enter') {
      this.props.onSubmit(this.state.value);
    }
  };

  render() {
    return (
      <SearchInput
        placeholder={'Search'}
        onChange={this.onChange}
        onKeyDown={this.onKeyDown}
        value={this.state.value}
      />
    );
  }
}

export default class Layout extends SonarPlugin<InspectorState> {
  static title = 'Layout';
  static id = 'Inspector';
  static icon = 'target';

  state = {
    elements: {},
    initialised: false,
    isSearchActive: false,
    root: null,
    selected: null,
    searchResults: null,
    outstandingSearchQuery: null,
    // properties for ax mode
    inAXMode: false,
    AXelements: {},
    AXinitialised: false,
    AXroot: null,
    AXselected: null,
    AXfocused: null,
    AXtoNonAXMapping: {},
    isAlignmentMode: false,
  };

  reducers = {
    SelectElement(state: InspectorState, {key, AXkey}: SelectElementArgs) {
      return {
        selected: key,
        AXselected: AXkey,
      };
    },

    ExpandElement(state: InspectorState, {expand, key}: ExpandElementArgs) {
      return {
        elements: {
          ...state.elements,
          [key]: {
            ...state.elements[key],
            expanded: expand,
          },
        },
      };
    },

    ExpandAXElement(state: InspectorState, {expand, key}: ExpandElementArgs) {
      return {
        AXelements: {
          ...state.AXelements,
          [key]: {
            ...state.AXelements[key],
            expanded: expand,
          },
        },
      };
    },

    ExpandElements(state: InspectorState, {elements}: ExpandElementsArgs) {
      const expandedSet = new Set(elements);
      const newState = {
        elements: {
          ...state.elements,
        },
      };
      for (const key of Object.keys(state.elements)) {
        newState.elements[key] = {
          ...newState.elements[key],
          expanded: expandedSet.has(key),
        };
      }
      return newState;
    },

    ExpandAXElements(state: InspectorState, {elements}: ExpandElementsArgs) {
      const expandedSet = new Set(elements);
      const newState = {
        AXelements: {
          ...state.AXelements,
        },
      };
      for (const key of Object.keys(state.AXelements)) {
        newState.AXelements[key] = {
          ...newState.AXelements[key],
          expanded: expandedSet.has(key),
        };
      }
      return newState;
    },

    UpdateElements(state: InspectorState, {elements}: UpdateElementsArgs) {
      const updatedElements = state.elements;
      const updatedMapping = state.AXtoNonAXMapping;

      for (const element of elements) {
        const current = updatedElements[element.id] || {};
        updatedElements[element.id] = {
          ...current,
          ...element,
        };
        const linked = element.extraInfo && element.extraInfo.linkedAXNode;
        if (linked && !updatedMapping[linked]) {
          updatedMapping[linked] = element.id;
        }
      }

      return {elements: updatedElements, AXtoNonAXMapping: updatedMapping};
    },

    UpdateAXElements(
      state: InspectorState,
      {elements, forFocusEvent}: UpdateAXElementsArgs,
    ) {
      const updatedElements = state.AXelements;

      // if focusEvent, previously focused element can be reset
      let updatedFocus = forFocusEvent ? null : state.AXfocused;

      for (const element of elements) {
        if (element.extraInfo && element.extraInfo.focused) {
          updatedFocus = element.id;
        }
        const current = updatedElements[element.id] || {};
        updatedElements[element.id] = {
          ...current,
          ...element,
        };
      }

      return {
        AXelements: updatedElements,
        AXfocused: updatedFocus,
      };
    },

    SetRoot(state: InspectorState, {root}: SetRootArgs) {
      return {root};
    },

    SetAXRoot(state: InspectorState, {root}: SetRootArgs) {
      return {AXroot: root};
    },

    SetSearchActive(
      state: InspectorState,
      {isSearchActive}: {isSearchActive: boolean},
    ) {
      return {isSearchActive};
    },

    SetAlignmentActive(
      state: InspectorState,
      {isAlignmentMode}: {isAlignmentMode: boolean},
    ) {
      return {isAlignmentMode};
    },

    SetAXMode(state: InspectorState, {inAXMode}: {inAXMode: boolean}) {
      return {inAXMode};
    },
  };

  search(query: string) {
    if (!query) {
      return;
    }
    this.setState({
      outstandingSearchQuery: query,
    });
    this.client
      .call('getSearchResults', {query: query})
      .then(response => this.displaySearchResults(response));
  }

  executeCommand(command: string) {
    return this.client.call('executeCommand', {
      command: command,
      context: this.state.inAXMode
        ? this.state.AXselected
        : this.state.selected,
    });
  }

  /**
   * When opening the inspector for the first time, expand all elements that contain only 1 child
   * recursively.
   */
  async performInitialExpand(element: Element, ax: boolean): Promise<void> {
    if (!element.children.length) {
      // element has no children so we're as deep as we can be
      return;
    }

    this.dispatchAction({
      expand: true,
      key: element.id,
      type: ax ? 'ExpandAXElement' : 'ExpandElement',
    });

    return this.getChildren(element.id, ax).then((elements: Array<Element>) => {
      this.dispatchAction({
        elements,
        type: ax ? 'UpdateAXElements' : 'UpdateElements',
      });

      if (element.children.length >= 2) {
        // element has two or more children so we can stop expanding
        return;
      }

      return this.performInitialExpand(
        (ax ? this.state.AXelements : this.state.elements)[element.children[0]],
        ax,
      );
    });
  }

  displaySearchResults({
    results,
    query,
  }: {
    results: SearchResultTree,
    query: string,
  }) {
    const elements = this.getElementsFromSearchResultTree(results);
    const idsToExpand = elements
      .filter(x => x.hasChildren)
      .map(x => x.element.id);

    const finishedSearching = query === this.state.outstandingSearchQuery;

    this.dispatchAction({
      elements: elements.map(x => x.element),
      type: 'UpdateElements',
    });
    this.dispatchAction({
      elements: idsToExpand,
      type: 'ExpandElements',
    });
    this.setState({
      searchResults: {
        matches: new Set(
          elements.filter(x => x.isMatch).map(x => x.element.id),
        ),
        query: query,
      },
      outstandingSearchQuery: finishedSearching
        ? null
        : this.state.outstandingSearchQuery,
    });
  }

  getElementsFromSearchResultTree(tree: SearchResultTree) {
    if (!tree) {
      return [];
    }
    var elements = [
      {
        id: tree.id,
        isMatch: tree.isMatch,
        hasChildren: Boolean(tree.children),
        element: tree.element,
      },
    ];
    if (tree.children) {
      for (const child of tree.children) {
        elements = elements.concat(this.getElementsFromSearchResultTree(child));
      }
    }
    return elements;
  }

  axEnabled(): boolean {
    // only visible internally for Android clients
    return AXToggleButtonEnabled && this.realClient.query.os === 'Android';
  }

  // expand tree and highlight click-to-inspect node that was found
  onSelectResultsRecieved(path: Array<ElementID>, ax: boolean) {
    this.getNodesAndDirectChildren(path, ax).then(
      (elements: Array<Element>) => {
        const selected = path[path.length - 1];

        this.dispatchAction({
          elements,
          type: ax ? 'UpdateAXElements' : 'UpdateElements',
        });

        // select node from ax tree if in ax mode
        // select node from main tree if not in ax mode
        // (also selects corresponding node in other tree if it exists)
        if ((ax && this.state.inAXMode) || (!ax && !this.state.inAXMode)) {
          const {key, AXkey} = this.getKeysFromSelected(selected);
          this.dispatchAction({key, AXkey, type: 'SelectElement'});
        }

        this.dispatchAction({
          isSearchActive: false,
          type: 'SetSearchActive',
        });

        for (const key of path) {
          this.dispatchAction({
            expand: true,
            key,
            type: ax ? 'ExpandAXElement' : 'ExpandElement',
          });
        }

        this.client.send('setHighlighted', {
          id: selected,
          isAlignmentMode: this.state.isAlignmentMode,
        });

        this.client.send('setSearchActive', {active: false});
      },
    );
  }

  initAX() {
    this.client.call('getAXRoot').then((element: Element) => {
      this.dispatchAction({elements: [element], type: 'UpdateAXElements'});
      this.dispatchAction({root: element.id, type: 'SetAXRoot'});
      this.performInitialExpand(element, true).then(() => {
        this.setState({AXinitialised: true});
      });
    });

    this.client.subscribe('axFocusEvent', ({isFocus}: AXFocusEventResult) => {
      // if focusing, need to update all elements in the tree because
      // we don't know which one now has focus
      const keys = isFocus ? Object.keys(this.state.AXelements) : [];

      // if unfocusing and currently focused element exists, update only the
      // focused element (and only if it is/was loaded in tree)
      if (
        !isFocus &&
        this.state.AXfocused &&
        this.state.AXelements[this.state.AXfocused]
      ) {
        keys.push(this.state.AXfocused);
      }

      this.getNodes(keys, {force: true, ax: true, forFocusEvent: true}).then(
        (elements: Array<Element>) => {
          this.dispatchAction({
            elements,
            forFocusEvent: true,
            type: 'UpdateAXElements',
          });
        },
      );
    });

    this.client.subscribe(
      'invalidateAX',
      ({nodes}: {nodes: Array<{id: ElementID}>}) => {
        this.invalidate(nodes.map(node => node.id), true).then(
          (elements: Array<Element>) => {
            this.dispatchAction({elements, type: 'UpdateAXElements'});
          },
        );
      },
    );

    this.client.subscribe('selectAX', ({path}: {path: Array<ElementID>}) => {
      this.onSelectResultsRecieved(path, true);
    });
  }

  init() {
    // persist searchActive state when moving between plugins to prevent multiple
    // TouchOverlayViews since we can't edit the view heirarchy in onDisconnect
    this.client.call('isSearchActive').then(({isSearchActive}) => {
      this.dispatchAction({type: 'SetSearchActive', isSearchActive});
    });

    performance.mark('LayoutInspectorInitialize');
    this.client.call('getRoot').then((element: Element) => {
      this.dispatchAction({elements: [element], type: 'UpdateElements'});
      this.dispatchAction({root: element.id, type: 'SetRoot'});
      this.performInitialExpand(element, false).then(() => {
        this.props.logger.trackTimeSince('LayoutInspectorInitialize');
        this.setState({initialised: true});
      });
    });

    this.client.subscribe(
      'invalidate',
      ({nodes}: {nodes: Array<{id: ElementID}>}) => {
        this.invalidate(nodes.map(node => node.id), false).then(
          (elements: Array<Element>) => {
            this.dispatchAction({elements, type: 'UpdateElements'});
          },
        );
      },
    );

    this.client.subscribe('select', ({path}: {path: Array<ElementID>}) => {
      this.onSelectResultsRecieved(path, false);
    });

    if (this.axEnabled()) {
      this.initAX();
    }
  }

  invalidate(ids: Array<ElementID>, ax: boolean): Promise<Array<Element>> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.getNodes(ids, {force: true, ax}).then(
      (elements: Array<Element>) => {
        const children = elements
          .filter(element => {
            const prev = (ax ? this.state.AXelements : this.state.elements)[
              element.id
            ];
            return prev && prev.expanded;
          })
          .map(element => element.children)
          .reduce((acc, val) => acc.concat(val), []);

        return Promise.all([elements, this.invalidate(children, ax)]).then(
          arr => {
            return arr.reduce((acc, val) => acc.concat(val), []);
          },
        );
      },
    );
  }

  getNodesAndDirectChildren(
    ids: Array<ElementID>,
    ax: boolean,
  ): Promise<Array<Element>> {
    return this.getNodes(ids, {force: false, ax}).then(
      (elements: Array<Element>) => {
        const children = elements
          .map(element => element.children)
          .reduce((acc, val) => acc.concat(val), []);

        return Promise.all([
          elements,
          this.getNodes(children, {force: false, ax}),
        ]).then(arr => {
          return arr.reduce((acc, val) => acc.concat(val), []);
        });
      },
    );
  }

  getChildren(key: ElementID, ax: boolean): Promise<Array<Element>> {
    return this.getNodes(
      (ax ? this.state.AXelements : this.state.elements)[key].children,
      {force: false, ax},
    );
  }

  getNodes(
    ids: Array<ElementID> = [],
    options: GetNodesOptions,
  ): Promise<Array<Element>> {
    const {force, ax, forFocusEvent} = options;
    if (!force) {
      ids = ids.filter(id => {
        return (
          (ax ? this.state.AXelements : this.state.elements)[id] === undefined
        );
      });
    }

    if (ids.length > 0) {
      performance.mark('LayoutInspectorGetNodes');
      return this.client
        .call(ax ? 'getAXNodes' : 'getNodes', {
          ids,
          forFocusEvent,
        })
        .then(({elements}: GetNodesResult) => {
          this.props.logger.trackTimeSince('LayoutInspectorGetNodes');
          return Promise.resolve(elements);
        });
    } else {
      return Promise.resolve([]);
    }
  }

  isExpanded(key: ElementID, ax: boolean): boolean {
    return ax
      ? this.state.AXelements[key].expanded
      : this.state.elements[key].expanded;
  }

  expandElement = (key: ElementID, ax: boolean): Promise<Array<Element>> => {
    const expand = !this.isExpanded(key, ax);
    return this.setElementExpanded(key, expand, ax);
  };

  setElementExpanded = (
    key: ElementID,
    expand: boolean,
    ax: boolean,
  ): Promise<Array<Element>> => {
    this.dispatchAction({
      expand,
      key,
      type: ax ? 'ExpandAXElement' : 'ExpandElement',
    });
    performance.mark('LayoutInspectorExpandElement');
    if (expand) {
      return this.getChildren(key, ax).then((elements: Array<Element>) => {
        this.dispatchAction({
          elements,
          type: ax ? 'UpdateAXElements' : 'UpdateElements',
        });

        // only expand extra components in the main tree when in AX mode
        if (this.state.inAXMode && !ax) {
          // expand child wrapper elements that aren't in the AX tree (e.g. fragments)
          for (const childElem of elements) {
            if (childElem.extraInfo && childElem.extraInfo.nonAXWithAXChild) {
              this.setElementExpanded(childElem.id, true, false);
            }
          }
        }

        this.props.logger.trackTimeSince('LayoutInspectorExpandElement');
        return Promise.resolve(elements);
      });
    } else {
      return Promise.resolve([]);
    }
  };

  deepExpandElement = async (key: ElementID, ax: boolean) => {
    const expand = !this.isExpanded(key, ax);
    if (!expand) {
      // we never deep unexpand
      return this.setElementExpanded(key, false, ax);
    }

    // queue of keys to open
    const keys = [key];

    // amount of elements we've expanded, we stop at 100 just to be safe
    let count = 0;

    while (keys.length && count < 100) {
      const key = keys.shift();

      // expand current element
      const children = await this.setElementExpanded(key, true, ax);

      // and add its children to the queue
      for (const child of children) {
        keys.push(child.id);
      }

      count++;
    }
  };

  onElementExpanded = (key: ElementID, deep: boolean) => {
    if (this.state.elements[key]) {
      if (deep) {
        this.deepExpandElement(key, false);
      } else {
        this.expandElement(key, false);
      }
    }

    if (this.state.AXelements[key]) {
      if (deep) {
        this.deepExpandElement(key, true);
      } else {
        this.expandElement(key, true);
      }
    }

    this.props.logger.track('usage', 'layout:element-expanded', {
      id: key,
      deep: deep,
    });
  };

  onFindClick = () => {
    const isSearchActive = !this.state.isSearchActive;
    this.dispatchAction({isSearchActive, type: 'SetSearchActive'});
    this.client.send('setSearchActive', {active: isSearchActive});
  };

  onToggleAccessibility = () => {
    const inAXMode = !this.state.inAXMode;
    this.dispatchAction({inAXMode, type: 'SetAXMode'});
  };
  onToggleAlignment = () => {
    const isAlignmentMode = !this.state.isAlignmentMode;
    this.dispatchAction({isAlignmentMode, type: 'SetAlignmentActive'});
  };

  getKeysFromSelected(selectedKey: ElementID) {
    let key = selectedKey;
    let AXkey = null;

    if (this.axEnabled()) {
      const linkedAXNode =
        this.state.elements[selectedKey] &&
        this.state.elements[selectedKey].extraInfo &&
        this.state.elements[selectedKey].extraInfo.linkedAXNode;

      // element only in main tree with linkedAXNode selected
      if (linkedAXNode) {
        AXkey = linkedAXNode;

        // element only in AX tree with linked nonAX (litho) element selected
      } else if (
        (!this.state.elements[selectedKey] ||
          this.state.elements[selectedKey].name === 'ComponentHost') &&
        this.state.AXtoNonAXMapping[selectedKey]
      ) {
        key = this.state.AXtoNonAXMapping[selectedKey];
        AXkey = selectedKey;

        // keys are same for both trees or 'linked' element does not exist
      } else {
        AXkey = selectedKey;
      }
    }

    return {key, AXkey};
  }

  onElementSelected = debounce((selectedKey: ElementID) => {
    const {key, AXkey} = this.getKeysFromSelected(selectedKey);

    this.dispatchAction({
      key: key,
      AXkey: AXkey,
      type: 'SelectElement',
    });
    this.client.send('setHighlighted', {
      id: selectedKey,
      isAlignmentMode: this.state.isAlignmentMode,
    });
    this.getNodes([key], {force: true, ax: false}).then(
      (elements: Array<Element>) => {
        this.dispatchAction({elements, type: 'UpdateElements'});
      },
    );
    if (AXkey) {
      this.getNodes([AXkey], {force: true, ax: true}).then(
        (elements: Array<Element>) => {
          this.dispatchAction({elements, type: 'UpdateAXElements'});
        },
      );
    }
  });

  onElementHovered = debounce((key: ?ElementID) => {
    this.client.send('setHighlighted', {
      id: key,
      isAlignmentMode: this.state.isAlignmentMode,
    });
  });

  getAXContextMenuExtensions() {
    return [
      {
        label: 'Focus',
        click: (id: ElementID) => {
          this.client.send('onRequestAXFocus', {id});
        },
      },
    ];
  }

  onDataValueChanged = (path: Array<string>, value: any) => {
    const ax = this.state.inAXMode;
    const id = ax ? this.state.AXselected : this.state.selected;
    this.client
      .call('setData', {id, path, value, ax})
      .then((element: Element) => {
        if (ax) {
          this.dispatchAction({
            elements: [element],
            type: 'UpdateAXElements',
          });
        }
      });

    this.props.logger.track('usage', 'layout:value-changed', {id, value, path});
  };

  renderSidebar = () => {
    if (this.state.inAXMode) {
      // empty if no element selected w/in AX node tree
      return (
        this.state.AXselected && (
          <InspectorSidebar
            element={this.state.AXelements[this.state.AXselected]}
            onValueChanged={this.onDataValueChanged}
            client={this.client}
          />
        )
      );
    } else {
      // empty if no element selected w/in view tree
      return (
        this.state.selected != null && (
          <InspectorSidebar
            element={this.state.elements[this.state.selected]}
            onValueChanged={this.onDataValueChanged}
            client={this.client}
          />
        )
      );
    }
  };

  render() {
    const {
      initialised,
      AXinitialised,
      selected,
      AXselected,
      AXfocused,
      root,
      AXroot,
      elements,
      AXelements,
      isSearchActive,
      inAXMode,
      outstandingSearchQuery,
      isAlignmentMode,
    } = this.state;

    return (
      <FlexColumn fill={true}>
        <Toolbar>
          <SearchIconContainer
            onClick={this.onFindClick}
            role="button"
            tabIndex={-1}
            title="Select an element on the device to inspect it">
            <Glyph
              name="target"
              size={16}
              color={
                isSearchActive
                  ? colors.macOSTitleBarIconSelected
                  : colors.macOSTitleBarIconActive
              }
            />
          </SearchIconContainer>
          {this.axEnabled() ? (
            <SearchIconContainer
              onClick={this.onToggleAccessibility}
              role="button"
              tabIndex={-1}
              title="Toggle accessibility mode within the LayoutInspector">
              <Glyph
                name="accessibility"
                size={16}
                color={
                  inAXMode
                    ? colors.macOSTitleBarIconSelected
                    : colors.macOSTitleBarIconActive
                }
              />
            </SearchIconContainer>
          ) : null}
          <SearchIconContainer
            onClick={this.onToggleAlignment}
            role="button"
            tabIndex={-1}
            title="Toggle AlignmentMode to show alignment lines">
            <Glyph
              name="borders"
              size={16}
              color={
                isAlignmentMode
                  ? colors.macOSTitleBarIconSelected
                  : colors.macOSTitleBarIconActive
              }
            />
          </SearchIconContainer>
          <SearchBox tabIndex={-1}>
            <SearchIcon
              name="magnifying-glass"
              color={colors.macOSTitleBarIcon}
              size={16}
            />
            <LayoutSearchInput onSubmit={this.search.bind(this)} />
            {outstandingSearchQuery && <LoadingSpinner size={16} />}
          </SearchBox>
        </Toolbar>
        <FlexRow fill={true}>
          {initialised ? (
            <ElementsInspector
              onElementSelected={this.onElementSelected}
              onElementHovered={this.onElementHovered}
              onElementExpanded={this.onElementExpanded}
              onValueChanged={this.onDataValueChanged}
              selected={selected}
              searchResults={this.state.searchResults}
              root={root}
              elements={elements}
            />
          ) : (
            <Center fill={true}>
              <LoadingIndicator />
            </Center>
          )}
          {AXinitialised && inAXMode ? <VerticalRule /> : null}
          {AXinitialised && inAXMode ? (
            <AXElementsInspector
              onElementSelected={this.onElementSelected}
              onElementHovered={this.onElementHovered}
              onElementExpanded={this.onElementExpanded}
              onValueChanged={this.onDataValueChanged}
              selected={AXselected}
              focused={AXfocused}
              searchResults={null}
              root={AXroot}
              elements={AXelements}
              contextMenuExtensions={this.getAXContextMenuExtensions()}
            />
          ) : null}
        </FlexRow>
        <SonarSidebar>{this.renderSidebar()}</SonarSidebar>
      </FlexColumn>
    );
  }
}
