export interface RailwayWorkspace {
  id: string;
  name: string;
}

export interface RailwayProject {
  id: string;
  name: string;
  services: RailwayService[];
  environments: RailwayEnvironment[];
}

export interface RailwayService {
  id: string;
  name: string;
  latestDeployment?: RailwayDeployment;
}

export interface RailwayEnvironment {
  id: string;
  name: string;
}

export interface RailwayDeployment {
  id: string;
  status: DeploymentStatus;
  url?: string;
  createdAt: string;
  environmentId?: string;
  environmentName?: string;
}

export type DeploymentStatus =
  | 'SUCCESS'
  | 'BUILDING'
  | 'DEPLOYING'
  | 'FAILED'
  | 'CRASHED'
  | 'SLEEPING'
  | 'QUEUED'
  | 'REMOVED'
  | 'REMOVING'
  | 'INITIALIZING'
  | 'WAITING'
  | 'SKIPPED'
  | 'NEEDS_APPROVAL';

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}
