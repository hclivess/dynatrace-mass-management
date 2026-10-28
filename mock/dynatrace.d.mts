export function createMock(): (method: string, href: string, authorization: string | undefined, body: unknown) => { status: number; body: unknown };
