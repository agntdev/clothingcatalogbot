import type { CatalogView, Ctx } from "./bot.js";

export function currentView(ctx: Ctx): CatalogView {
  return ctx.session.catalogStack?.at(-1) ?? { kind: "menu" };
}

export function resetNavigation(ctx: Ctx): void {
  ctx.session.catalogStack = [{ kind: "menu" }];
  ctx.session.catalogCategory = undefined;
  ctx.session.catalogPage = undefined;
}

export function pushView(ctx: Ctx, view: CatalogView): void {
  const stack = ctx.session.catalogStack ?? [{ kind: "menu" }];
  const current = stack.at(-1);
  if (JSON.stringify(current) !== JSON.stringify(view)) stack.push(view);
  ctx.session.catalogStack = stack.slice(-20);
  ctx.session.catalogCategory = view.categoryId;
  ctx.session.catalogPage = view.page;
}

export function popView(ctx: Ctx): CatalogView {
  const stack = ctx.session.catalogStack ?? [{ kind: "menu" }];
  if (stack.length > 1) stack.pop();
  ctx.session.catalogStack = stack;
  const view = stack.at(-1) ?? { kind: "menu" };
  ctx.session.catalogCategory = view.categoryId;
  ctx.session.catalogPage = view.page;
  return view;
}
