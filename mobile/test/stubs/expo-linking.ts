export const getInitialURL = async () => null;
export const parse = (url: string) => ({ queryParams: Object.fromEntries(new URL(url).searchParams) });
