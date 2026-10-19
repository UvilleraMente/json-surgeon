export interface Example {
  readonly id: string;
  readonly label: string;
  readonly rootName: string;
  readonly input: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'llm',
    label: 'LLM response with code fence',
    rootName: 'Order',
    input: `Sure! Here's the order data you asked for, formatted as JSON:

\`\`\`json
{
  "orderId": "A-1042",
  "createdAt": "2026-03-14T09:26:53Z",
  "customer": {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "vip": True,
  },
  "items": [
    {"sku": "KB-01", "title": "Mechanical keyboard", "qty": 1, "price": 129.99},
    {"sku": "MS-02", "title": "Wireless mouse", "qty": 2, "price": 39.5, "giftWrap": true}
    {"sku": "CB-03", "title": "USB-C cable", "qty": 3, "price": 9, "note": None},
  ],
  "total": 248.99, // computed server-side
}
\`\`\`

Let me know if you'd like it in another format!`,
  },
  {
    id: 'truncated',
    label: 'Truncated API response',
    rootName: 'SearchResponse',
    input: `{
  "page": 1,
  "totalResults": 1873,
  "results": [
    {
      "id": "8f14e45f-ceea-467f-a0e3-5e8a8b5c9d21",
      "title": "Getting started with signals",
      "tags": ["angular", "signals"],
      "score": 0.982
    },
    {
      "id": "c9f0f895-fb98-4b91-9f5a-2b7c8e1d3a40",
      "title": "Records in C# 12",
      "tags": ["dotnet", "csharp"],
      "score": 0.951,
      "author": {"name": "Andrés", "handle": "@andres`,
  },
  {
    id: 'python',
    label: 'Python dict',
    rootName: 'Config',
    input: `{'service': 'billing-api',
 'debug': False,
 'replicas': 3,
 'timeout_seconds': 30.5,
 'owner': None,
 'regions': ('us-east-1', 'eu-west-1'),
 'feature_flags': {'new_checkout': True, 'beta_banner': False},
 'motto': 'It\\'s always DNS'}`,
  },
  {
    id: 'js',
    label: 'JS object with comments',
    rootName: 'AppSettings',
    input: `// app.config.js — copied straight from the source
{
  name: 'json-surgeon',
  version: "1.0.0",
  /* feature toggles */
  features: {
    darkMode: true,
    maxUploadSize: 0x500000, // 5 MB
    retries: +3,
    ratio: .75,
  },
  locales: ['en', 'es', 'fr',],
  lastBuild: undefined,
  cacheHitRate: NaN,
}`,
  },
  {
    id: 'valid',
    label: 'Valid JSON',
    rootName: 'Team',
    input: `{
  "team": "Platform",
  "founded": "2019-05-01",
  "members": [
    {"id": 1, "name": "Grace", "role": "lead", "skills": ["go", "k8s"]},
    {"id": 2, "name": "Linus", "role": "engineer", "skills": ["c"], "manager": 1},
    {"id": 3, "name": "Margaret", "role": "engineer", "skills": [], "manager": null}
  ]
}`,
  },
];
