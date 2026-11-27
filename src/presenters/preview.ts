import type { EditEntityKey } from "../editing/entities.js";
import type { PreviewData } from "../services/editing/preview-service.js";
import type {
  ContentPageViewModel,
  EditProblemViewModel,
  InstanceViewModel,
  PreviewViewModel,
  ProductTeamServiceViewModel,
  ToolViewModel,
  VendorViewModel,
} from "../view-models.js";
import { editPaths } from "./edit.js";
import { HOME_BREADCRUMB } from "./format.js";
import { presentContentPage } from "./pages.js";
import { presentProductTeamService } from "./organisation.js";
import { presentInstance, presentTool, presentVendor } from "./tools.js";

// The editing preview shows the record's own read page, built from the typed
// values by the same presenters the read pages use.

/** A read page, with the template that shows it. */
export type PreviewPage =
  | { readonly template: "pages/vendor.njk"; readonly page: VendorViewModel }
  | { readonly template: "pages/tool.njk"; readonly page: ToolViewModel }
  | { readonly template: "pages/instance.njk"; readonly page: InstanceViewModel }
  | {
      readonly template: "pages/product-team-service.njk";
      readonly page: ProductTeamServiceViewModel;
    }
  | { readonly template: "pages/content-page.njk"; readonly page: ContentPageViewModel };

const BANNER_TEXT =
  "This is a preview of your changes. They are not saved yet, and readers can’t see them.";
const NOT_SHOWN_TEXT =
  " Pages of this type are not shown on the Hub yet, so it is shown here as guidance.";

export function presentPreviewBanner(
  key: EditEntityKey,
  id: number | undefined,
  token: string,
  page: { readonly notShownToReaders: boolean; readonly draft: boolean },
): PreviewViewModel {
  return {
    text: page.notShownToReaders ? `${BANNER_TEXT}${NOT_SHOWN_TEXT}` : BANNER_TEXT,
    token,
    // A draft stays hidden from readers when it is saved, so it isn't "published".
    save: {
      text: page.draft ? "Save draft" : "Save and publish",
      action: editPaths.publish(key, id),
    },
    edit: { text: "Continue editing", action: editPaths.resume(key, id) },
  };
}

export function presentPreview(data: PreviewData, preview: PreviewViewModel): PreviewPage {
  switch (data.kind) {
    case "vendors":
      return {
        template: "pages/vendor.njk",
        page: { ...presentVendor(data.detail, data.groups), preview },
      };
    case "tools":
      return {
        template: "pages/tool.njk",
        page: { ...presentTool(data.detail, data.groups), preview },
      };
    case "instances":
      return {
        template: "pages/instance.njk",
        page: { ...presentInstance(data.detail, data.groups), preview },
      };
    case "services":
      return {
        template: "pages/product-team-service.njk",
        page: { ...presentProductTeamService(data.detail, data.groups, data.guides), preview },
      };
    case "pages":
      return {
        template: "pages/content-page.njk",
        page: { ...presentContentPage(data.section, data.detail, data.groups), preview },
      };
  }
}

/** The page shown when a preview's payload can't be used. */
export function presentPreviewProblem(
  key: EditEntityKey,
  id: number | undefined,
): EditProblemViewModel {
  return {
    title: "The preview can’t be saved",
    breadcrumbs: [HOME_BREADCRUMB],
    hasError: true,
    errors: [
      {
        text: "The preview has expired or can’t be checked, so nothing was saved. Go back to the form, then preview your changes again.",
      },
    ],
    back: {
      text: "Go back to the form",
      href: id === undefined ? editPaths.add(key) : editPaths.record(key, id),
    },
  };
}
