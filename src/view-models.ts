/**
 * View models: the only data templates receive (as `page`). Every template is
 * listed in `Views`, so `render` checks at compile time that a template gets
 * the right model.
 */

export interface Breadcrumb {
  readonly text: string;
  readonly href: string;
}

export interface LinkItem {
  readonly text: string;
  readonly href: string;
  readonly description?: string;
}

/** Fields every page has. Read by layouts/base.njk. */
export interface PageViewModel {
  /** The h1 and the first part of the document title. */
  readonly title: string;
  readonly breadcrumbs?: readonly Breadcrumb[];
}

/** Read by layouts/listing.njk. */
export interface ListingViewModel extends PageViewModel {
  readonly items: readonly LinkItem[];
}

export interface HomeViewModel extends PageViewModel {
  readonly sections: readonly LinkItem[];
}

export interface SectionViewModel extends ListingViewModel {
  readonly description: string;
}

export interface ErrorViewModel extends PageViewModel {
  /** Shown on the 500 page so users can quote it. */
  readonly requestId?: string;
}

export interface Views {
  "pages/home.njk": HomeViewModel;
  "pages/section.njk": SectionViewModel;
  "errors/403.njk": ErrorViewModel;
  "errors/404.njk": ErrorViewModel;
  "errors/500.njk": ErrorViewModel;
}

export type ViewName = keyof Views;
