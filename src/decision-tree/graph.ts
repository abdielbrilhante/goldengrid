import { ReactiveState } from '../shared/use-reactive-state';
import { agentService } from '../simulation/agents';
import { actions, decisions } from '../simulation/constants';
import { agentTemplateSchema } from './schema';
import type { AgentTemplate, AgentTree, DecisionItem, EdgeItem } from './types';
import { randId } from './utils';

export class Graph extends ReactiveState {
  timeout: number | null = null;

  $nodes: AgentTree;
  $edges: EdgeItem[] = [];
  $highlight: string[] = [];
  $errors: {
    loops: string[][];
  } = {
    loops: [],
  };

  $name: string;

  constructor(private id: string) {
    super();
    const agentDef = agentService.parse(id)!;
    this.$name = agentDef.name;
    this.$nodes = agentDef.tree;

    setTimeout(this.rebuildEdges);
  }

  write(key: keyof Graph, value: unknown) {
    if (key !== '$errors') {
      this.check();
    }

    super.write(key, value);
  }

  commit() {
    super.commit();

    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.timeout = setTimeout(this.persist, 500);
  }

  persist = () => {
    agentService.persist({
      id: this.id,
      name: this.$name,
      tree: this.$nodes,
    });
  };

  size() {
    let height = 0;
    let width = 0;
    for (const node of this.$nodes) {
      const element = Graph.queryByDataId(node.id);
      if (element) {
        const rect = element.getBoundingClientRect();
        height = Math.max(height, node.y + rect.height);
        width = Math.max(width, node.x + rect.width);
      }
    }

    return { width: width + 200, height: height + 200 };
  }

  check() {
    this.$errors = {
      loops: this.visit(this.$nodes[0].id),
    };
  }

  visit(id: string | null, paths: string[] = [], loops: string[][] = []) {
    const node = this.findNodeById(id);
    if (id && node && (node.type === 'decision' || node.type === 'start')) {
      if (paths.includes(id)) {
        paths.push(id);
        loops.push(paths);
        return loops;
      }

      paths.push(id);
      for (const edge of Object.values(node.next)) {
        this.visit(edge, [...paths], loops);
      }
    }

    return loops;
  }

  rebuildEdges = (id?: string) => {
    const next: EdgeItem[] = [
      {
        id: randId(),
        type: 'edge',
        from: '',
        to: '',
        key: '',
        length: 0,
        x: 0,
        y: 0,
        rotation: 0,
      },
    ];

    for (const node of this.$nodes) {
      if (node.type === 'decision' || node.type === 'start') {
        for (const [key, to] of Object.entries(node.next)) {
          if (id && node.id !== id && to !== id) {
            const stable = this.$edges.find(
              (edge) =>
                edge.from === node.id && edge.key === key && edge.to === to,
            );
            if (stable) {
              next.push(stable);
              continue;
            }
          }

          const position = this.computeEdgePosition({
            from: node.id,
            key: key,
            to: to,
          });

          if (position) {
            next.push({
              id: randId(),
              type: 'edge',
              ...position,
            });
          }
        }
      }
    }

    this.$edges = next;
  };

  findNodeById(id: string | null) {
    return this.$nodes.find((node) => node.id === id);
  }

  addDecisionNode = () => {
    const id = randId();
    this.$nodes = this.$nodes.concat({
      id: id,
      type: 'decision',
      next: {
        '<1>': '',
        '<2>': '',
      },
      test: decisions[0],
      x: 0,
      y: 0,
    }) as AgentTree;
    this.updateNode(id);
  };

  addActionNode = () => {
    const id = randId();
    this.$nodes = this.$nodes.concat({
      id: id,
      type: 'action',
      command: actions[0],
      x: 0,
      y: 0,
    }) as AgentTree;
    this.updateNode(id);
  };

  updateNode(id: string) {
    this.$nodes = this.$nodes.map((node) => {
      return id === node.id ? { ...node } : node;
    }) as AgentTree;

    this.rebuildEdges(id);
  }

  updateNodes() {
    this.rebuildEdges();
  }

  updateDummyEdge(from: string, vertex: string, x: number, y: number) {
    this.$edges = [
      {
        ...this.$edges[0],
        ...this.computeDummyEdgePosition(from, vertex, x, y),
      },
      ...this.$edges.slice(1),
    ];
  }

  deleteNode = (id: string) => {
    for (const node of this.$nodes) {
      if (node.type === 'decision') {
        for (const [key, value] of Object.entries(node.next)) {
          if (value === id) {
            node.next[key] = null;
          }
        }
      }
    }

    this.$nodes = this.$nodes.filter((node) => node.id !== id) as AgentTree;
    this.rebuildEdges(id);
  };

  updateVertexes = (id: string, keys: string[]) => {
    const node = this.findNodeById(id) as DecisionItem;
    const updated: Record<string, string | null> = {};
    for (const [index, key] of keys.entries()) {
      updated[key] = Object.values(node.next)[index];
    }

    node.next = updated;
    this.rebuildEdges(id);
  };

  computeDummyEdgePosition(
    fromId: string,
    vertex: string,
    x: number,
    y: number,
  ) {
    const from = this.findNodeById(fromId) as DecisionItem;

    const fromRect = Graph.queryByDataId(fromId)!.getBoundingClientRect() ?? {
      width: 160,
      height: 60,
    };

    const paths = Object.keys(from.next);
    const numPaths = paths.length;
    const index = paths.indexOf(vertex);

    const fx = from.x + ((index + 0.5) * fromRect.width) / numPaths;
    const fy = from.y + fromRect.height;
    const tx = x - fromRect.x + from.x;
    const ty = y - fromRect.y + from.y;

    const edgeLength = Math.sqrt(
      Math.pow(Math.abs(tx - fx), 2) + Math.pow(Math.abs(ty - fy), 2),
    );

    return {
      length: edgeLength,
      x: fx,
      y: from.y + fromRect.height,
      rotation: (180 * Math.atan2(ty - fy, tx - fx)) / Math.PI,
    };
  }

  computeEdgePosition(edge: { from: string; to: string | null; key: string }) {
    const { from: fromId, key, to: toId } = edge;
    const from = this.findNodeById(fromId) as DecisionItem;
    const to = this.findNodeById(toId);

    if (!to) {
      return null;
    }

    const paths = Object.keys(from.next);
    const numPaths = paths.length;
    const toIndex = paths.indexOf(key);

    const fromRect = Graph.queryByDataId(fromId)!.getBoundingClientRect();

    const toRect = Graph.queryByDataId(to.id)!.getBoundingClientRect();

    const fx = from.x + ((toIndex + 0.5) * fromRect.width) / numPaths;
    const fy = from.y + fromRect.height;
    const tx = to.x + toRect.width / 2;
    const ty = to.y;

    const edgeLength = Math.sqrt(
      Math.pow(Math.abs(tx - fx), 2) + Math.pow(Math.abs(ty - fy), 2),
    );

    return {
      ...edge,
      to: edge.to!,
      length: edgeLength,
      x: fx,
      y: from.y + fromRect.height,
      rotation: (180 * Math.atan2(ty - fy, tx - fx)) / Math.PI,
    };
  }

  replace(agentDef: AgentTemplate) {
    this.$name = agentDef.name;
    this.$nodes = agentDef.tree;
  }

  toJSON() {
    return JSON.stringify(
      {
        id: this.id,
        name: this.$name,
        tree: this.$nodes,
      },
      null,
      4,
    );
  }

  static queryByDataId(id: string) {
    return document.querySelector(`[data-id=${id}]`);
  }

  static fromJSON(json: string) {
    try {
      return agentTemplateSchema.parse(JSON.parse(json));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      return null;
    }
  }
}
