import { BUILD } from '@app-data';
import { MEMBER_FLAGS } from '@utils/constants';

import type * as d from '../declarations';

/**
 * A WeakMap mapping runtime component references to their corresponding host reference
 * instances.
 *
 * **Note**: If we're in an HMR context we need to store a reference to this
 * value on `window` in order to maintain the mapping of {@link d.RuntimeRef}
 * to {@link d.HostRef} across HMR updates.
 *
 * This is necessary because when HMR updates for a component are processed by
 * the browser-side dev server client the JS bundle for that component is
 * re-fetched. Since the module containing {@link hostRefs} is included in
 * that bundle, if we do not store a reference to it the new iteration of the
 * component will not have access to the previous hostRef map, leading to a
 * bug where the new version of the component cannot properly initialize.
 */
const hostRefs: WeakMap<d.RuntimeRef, d.HostRef> = /*@__PURE__*/ BUILD.hotModuleReplacement
  ? ((window as any).__STENCIL_HOSTREFS__ ||= new WeakMap())
  : new WeakMap();

/**
 * Given a {@link d.RuntimeRef} remove the corresponding {@link d.HostRef} from
 * the {@link hostRefs} WeakMap.
 *
 * @param ref the runtime ref of interest
 * @returns — true if the element was successfully removed, or false if it was not present.
 */
export const deleteHostRef = (ref: d.RuntimeRef) => hostRefs.delete(ref);

/**
 * Given a {@link d.RuntimeRef} retrieve the corresponding {@link d.HostRef}
 *
 * @param ref the runtime ref of interest
 * @returns the Host reference (if found) or undefined
 */
export const getHostRef = (ref: d.RuntimeRef): d.HostRef | undefined => hostRefs.get(ref);

/**
 * Register a lazy instance with the {@link hostRefs} object so it's
 * corresponding {@link d.HostRef} can be retrieved later.
 *
 * @param lazyInstance the lazy instance of interest
 * @param hostRef that instances `HostRef` object
 */
export const registerInstance = (lazyInstance: any, hostRef: d.HostRef) => {
  hostRefs.set((hostRef.$lazyInstance$ = lazyInstance), hostRef);
  if (BUILD.modernPropertyDecls && (BUILD.state || BUILD.prop)) {
    reWireGetterSetter(lazyInstance, hostRef);
  }
};

/**
 * Register a host element for a Stencil component, setting up various metadata
 * and callbacks based on {@link BUILD} flags as well as the component's runtime
 * metadata.
 *
 * @param hostElement the host element to register
 * @param cmpMeta runtime metadata for that component
 * @returns a reference to the host ref WeakMap
 */
export const registerHost = (hostElement: d.HostElement, cmpMeta: d.ComponentRuntimeMeta) => {
  const hostRef: d.HostRef = {
    $flags$: 0,
    $hostElement$: hostElement,
    $cmpMeta$: cmpMeta,
    $instanceValues$: new Map(),
  };
  if (BUILD.isDev) {
    hostRef.$renderCount$ = 0;
  }
  if (BUILD.method && BUILD.lazyLoad) {
    hostRef.$onInstancePromise$ = new Promise((r) => (hostRef.$onInstanceResolve$ = r));
  }
  if (BUILD.asyncLoading) {
    hostRef.$onReadyPromise$ = new Promise((r) => (hostRef.$onReadyResolve$ = r));
    hostElement['s-p'] = [];
    hostElement['s-rc'] = [];
  }

  const ref = hostRefs.set(hostElement, hostRef);

  if (!BUILD.lazyLoad && BUILD.modernPropertyDecls && (BUILD.state || BUILD.prop)) {
    reWireGetterSetter(hostElement, hostRef);
  }

  return ref;
};

export const isMemberInElement = (elm: any, memberName: string) => memberName in elm;

/**
 * - Re-wires component prototype `get` / `set` with instance `@State` / `@Prop` decorated fields.
 * - Makes sure the initial value from the `Element` is synced to the instance `@Prop` decorated fields.
 *
 * Background:
 * During component init, Stencil loops through any `@Prop()` or `@State()` decorated properties
 * and sets up getters and setters for each (within `src/runtime/proxy-component.ts`) on a component prototype.
 *
 * These accessors sync-up class instances with their `Element` and controls re-renders.
 * With modern JS, compiled classes (e.g. `target: 'es2022'`) compiled Stencil components went from:
 *
 * ```ts
 * class MyComponent {
 *   constructor() {
 *     this.prop1 = 'value1';
 *   }
 * }
 * ```
 * To:
 * ```ts
 * class MyComponent {
 *  prop1 = 'value2';
 *  // ^^ These override the accessors originally set on the prototype
 * }
 * ```
 *
 * @param instance - class instance to re-wire
 * @param hostRef - component reference meta
 */
const reWireGetterSetter = (instance: any, hostRef: d.HostRef) => {
  const cmpMeta = hostRef.$cmpMeta$;
  const members = Object.entries(cmpMeta.$members$ ?? {});

  members.map(([memberName, [memberFlags]]) => {
    if ((BUILD.state || BUILD.prop) && (memberFlags & MEMBER_FLAGS.Prop || memberFlags & MEMBER_FLAGS.State)) {
      const ogValue = instance[memberName];

      // Get the original Stencil prototype `get` / `set`
      const ogDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(instance), memberName);

      // Re-wire original accessors to the new instance
      Object.defineProperty(instance, memberName, {
        get() {
          return ogDescriptor.get.call(this);
        },
        set(newValue) {
          ogDescriptor.set.call(this, newValue);
        },
        configurable: true,
        enumerable: true,
      });
      instance[memberName] = hostRef.$instanceValues$.has(memberName)
        ? hostRef.$instanceValues$.get(memberName)
        : ogValue;
    }
  });
};
