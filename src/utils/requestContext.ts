import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  token?: string;
  userId?: string;
  tenantId?: string;
  contextTenantId?: string;
  tenantDomain?: string;
}


const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  // Set the context for a request
  set: (context: RequestContext) => {
    const currentContext = asyncLocalStorage.getStore() || {};
    asyncLocalStorage.enterWith({ ...currentContext, ...context });
  },

  // Get the current context 
  get: (): RequestContext => {
    return asyncLocalStorage.getStore() || {};
  },

  // Run a function with the given context
  run: <T>(context: RequestContext, fn: () => T): T => {
    return asyncLocalStorage.run(context, fn);
  }
};