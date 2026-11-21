import type { Project } from '~/entities/studio/types'

/** Media URLs are delivery details. Only durable IDs enter stored documents. */
export function projectPayload(project: Project) {
  return {
    title: project.title,
    nodes: project.nodes.map((node) => {
      if (node.type !== 'reference') return JSON.parse(JSON.stringify(node))
      if (!node.assetId) throw new Error('Upload this reference before saving the canvas.')
      const { url: _url, ...durable } = node
      return { ...durable }
    }),
    edges: project.edges.map((edge) => ({ ...edge })),
    viewport: { ...project.viewport },
  }
}
