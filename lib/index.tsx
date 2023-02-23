import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";
import { Overwrite, RouteParameters } from "./RouteParameters";

export interface RouterT<
  ContextualParameters = {},
  ExplicitHandlers = {},
  Subrouters = {},
  SubroutedAt extends string = "/"
> {
  use: <T extends string, PathParameters = RouteParameters<T>>(
    path: T,
    page?: React.FC<{ pathParams: Overwrite<PathParameters, ContextualParameters> }>
  ) => RouterT<
    ContextualParameters,
    ExplicitHandlers & { [key in T]: Overwrite<PathParameters, ContextualParameters> },
    Subrouters,
    SubroutedAt
  >;

  useSubrouter: <A, B, C, ForkedFrom extends string = "/">(
    subRouter: RouterT<A, B, C, ForkedFrom>
  ) => RouterT<
    ContextualParameters,
    ExplicitHandlers,
    Overwrite<{ [key in ForkedFrom]: RouterT<A, B, C, ForkedFrom> }, Subrouters>,
    SubroutedAt
  >;

  subrouter: <T extends string, PathParameters = RouteParameters<T>>(
    path: T
  ) => RouterT<Overwrite<PathParameters, ContextualParameters>, {}, Subrouters, T>;

  forkedAt: () => SubroutedAt;

  findPathHandler: (pathParams: string[]) => { pathParams: Record<string, string>; Page: React.FC<any> } | undefined;

  populate: (config: Record<string, Object | Function>) => void;

  _metadata: {
    context: ContextualParameters;
    explicits: ExplicitHandlers;
    subrouters: Subrouters;
    subroutedAt: SubroutedAt;
  };
}

function splitPathsIntoParts(path: string) {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  const parts = normalized.split("/").filter((e) => e.length > 0);
  return parts;
}

export function Router<
  ContextualParameters = {},
  ExplicitHandlers = {},
  Subrouters = {},
  SubroutedAt extends string = "/"
>(subroutedAt = "/" as SubroutedAt): RouterT<ContextualParameters, ExplicitHandlers, Subrouters, SubroutedAt> {
  // Routes are seperated by the number of parts they have so indexing is faster
  const explicitHandlers: { parts: string[]; raw: string; page: React.FC<any> }[][] = [];
  const subrouters: { validators: string[]; raw: string; subrouter: RouterT<any, any, any, any> }[] = [];

  return {
    _metadata: {
      explicits: explicitHandlers,
      subrouters: subrouters,
      subroutedAt: subroutedAt,
    } as any,

    forkedAt: function () {
      return subroutedAt;
    },

    use: function <T extends string, PathParameters = RouteParameters<T>>(
      path: T,
      page?: React.FC<{ pathParams: Overwrite<PathParameters, ContextualParameters> }>
    ) {
      const parts = splitPathsIntoParts(path);

      if (explicitHandlers[parts.length] === undefined) explicitHandlers[parts.length] = [];
      explicitHandlers[parts.length].push({ parts, raw: path, page: page as any });

      return this as RouterT<
        ContextualParameters,
        ExplicitHandlers & { [key in T]: Overwrite<PathParameters, ContextualParameters> },
        Subrouters,
        SubroutedAt
      >;
    },

    useSubrouter: function <A, B, C, ForkedFrom extends string>(subrouter: RouterT<A, B, C, ForkedFrom>) {
      const path = subrouter.forkedAt();
      subrouters.push({ validators: path.split("/").filter((e) => e.length > 0), raw: path, subrouter });

      return this as RouterT<
        ContextualParameters,
        ExplicitHandlers,
        Overwrite<{ [key in ForkedFrom]: RouterT<A, B, C, ForkedFrom> }, Subrouters>,
        SubroutedAt
      >;
    },

    subrouter: function <T extends string, PathParameters = RouteParameters<T>>(subpath: T) {
      return Router<Overwrite<PathParameters, ContextualParameters>, {}, Subrouters, T>(subpath);
    },

    /** runs recursive pattern matching to find a handler that matches the input */
    findPathHandler: function (pathParams) {
      // find an explicit handler for pathParams
      outer: for (const { parts, page } of explicitHandlers[pathParams.length] ?? []) {
        const potentialParams: Record<string, string> = {};

        // check if parts match up against pathParams
        for (let i = 0; i < pathParams.length; i++) {
          const part = parts[i],
            user = pathParams[i];

          if (!part.startsWith(":") && user !== part) continue outer;
          potentialParams[part.replace(":", "")] = user;
        }

        return { Page: page, pathParams: potentialParams };
      }

      // find a subrouter that matches
      outer: for (const { subrouter, validators } of subrouters) {
        const potentialParams: Record<string, string> = {};

        for (let i = 0; i < validators.length; i++) {
          const part = validators[i],
            user = pathParams[i];

          if (!part.startsWith(":") && part !== user) continue outer;
          potentialParams[part.replace(":", "")] = user;
        }

        const inner = subrouter.findPathHandler(pathParams.slice(validators.length));
        if (inner !== undefined) {
          return {
            Page: inner.Page,
            pathParams: { ...inner.pathParams, ...potentialParams },
          };
        }
      }

      return undefined;
    },

    populate: function (config: Record<string, any>) {
      const entries = Object.entries(config);
      const handlers = entries.filter(([, val]) => typeof val === "function");
      const subrouterConfig = entries.filter(([, val]) => typeof val !== "function");

      handlers.forEach(([key, page]) => {
        const parts = splitPathsIntoParts(key);
        const handler = (explicitHandlers[parts.length] ?? []).find(({ raw }) => key === raw);
        if (handler) handler.page = page;
      });

      subrouterConfig.forEach(([key, value]) => {
        const subrouter = subrouters.find(({ raw }) => raw === key);
        if (subrouter) {
          subrouter.subrouter.populate(value);
        }
      });
    },
  };
}

export type RouterClientT<Router extends RouterT<unknown>, PassedContext = {}> = {
  [key in keyof Router["_metadata"]["explicits"]]: {
    // @ts-expect-error
    use: (params: Overwrite<PassedContext, RouteParameters<key>>, id?: string) => void;

    // @ts-expect-error
    getLink: (params: Overwrite<PassedContext, RouteParameters<key>>, id?: string) => string;
  };
} & {
  [key in keyof Router["_metadata"]["subrouters"]]: RouterClientT<
    // @ts-expect-error
    Router["_metadata"]["subrouters"][key],
    // @ts-expect-error
    Overwrite<RouteParameters<key>, PassedContext>
  >;
};

export function RouterClient<PassedRouter extends RouterT>(
  router: PassedRouter,
  controller: RouterRendererContext,
  prefixString = ""
): RouterClientT<PassedRouter> {
  /** The explicit handlers connected to this router */
  const handlers = router._metadata.explicits as { parts: string[]; page: React.FC<any> }[][];

  /** subrouters connected to this router */
  const subrouters = router._metadata.subrouters as { validators: string[]; subrouter: RouterT<any, any, any, any> }[];

  const ret: Record<string, { use: (params: Record<string, string>) => void } | RouterClientT<RouterT>> = {};

  for (const handlerBucket of handlers) {
    for (const { parts } of handlerBucket ?? []) {
      const destPath = `/${parts.join("/")}`;

      const getLink = function (params: Record<string, string>, id = "") {
        let mutable = `${prefixString}${destPath}`;

        for (const [key, value] of Object.entries(params)) {
          mutable = mutable.replaceAll(`:${key}`, value);
        }

        return mutable + (id.length > 0 ? `#${id}` : "");
      };

      ret[destPath] = {
        getLink,

        use: function (params: Record<string, string>, id = "") {
          const link = getLink(params, id);
          controller.moveTo(link);
        },
      };
    }
  }

  for (const { subrouter, validators } of subrouters) {
    const combined = `/${validators.join("/")}`;
    ret[combined] = RouterClient(subrouter, controller, `${prefixString}${combined}`);
  }

  return ret as any;
}

interface RouterRendererContext {
  moveTo: (newPath: string) => void;
}

export const routerRendererContext = createContext<RouterRendererContext>(undefined as any);

export type RouterRendererConfigT<Router extends RouterT<unknown>, PassedContext = {}> = {
  [key in keyof Router["_metadata"]["explicits"]]: React.FC<{
    // @ts-expect-error
    pathParams: Overwrite<PassedContext, RouteParameters<key>>;
  }>;
} & {
  [key in keyof Router["_metadata"]["subrouters"]]: RouterRendererConfigT<
    // @ts-expect-error
    Router["_metadata"]["subrouters"][key],
    // @ts-expect-error
    Overwrite<RouteParameters<key>, PassedContext>
  >;
};

interface RouterRendererProps<Router extends RouterT> {
  router: Router;
  config: RouterRendererConfigT<Router>;
  NotFound: React.FC<{ path: string }>;
}

export function RouterRenderer<Router extends RouterT>({ router, config, NotFound }: RouterRendererProps<Router>) {
  const [path, setPath] = useState(window.location.pathname);
  router.populate(config);

  const controller: RouterRendererContext = {
    moveTo: function (newPath: string) {
      window.history.replaceState(null, document.title, newPath);
      setPath(newPath);
    },
  };

  const [pathName, elementId] = path.split("#");
  const handler = router.findPathHandler(pathName.split("/").filter((e) => e.length > 0));

  useLayoutEffect(() => {
    if (typeof elementId === "string") {
      const element = document.getElementById(elementId);
      if (element) element.scrollIntoView();
    }
  }, [pathName, elementId]);

  return (
    <routerRendererContext.Provider value={controller}>
      {handler === undefined ? <NotFound path={path} /> : <handler.Page pathParams={handler.pathParams} />}
    </routerRendererContext.Provider>
  );
}

export type Page<T extends string[]> = React.FC<{ pathParams: { [key in T[number]]: string } }>;

export interface LinkProps<T extends Record<string, string>> {
  route: { use: (params: T) => void; getLink: (params: T) => string };
  pathParams: T;
  children: React.ReactNode;
}

export function Link<T extends Record<string, string>>({ route, pathParams, children }: LinkProps<T>) {
  return (
    <a
      href={route.getLink(pathParams)}
      onClick={(e) => {
        e.preventDefault();
        route.use(pathParams);
      }}
    >
      {children}
    </a>
  );
}
