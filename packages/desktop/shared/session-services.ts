export interface ServiceEndpoint { address: string; port: number; pid: number; url?: string }
interface SessionService {
	id: string;
	command: string;
	pid?: number;
	startedAt: number;
	exitCode: number | null;
	finishedAt?: number;
	status: "running" | "stopping" | "exited" | "failed";
	error?: string;
	endpoints: ServiceEndpoint[];
}
export interface SessionServices { jobs: SessionService[]; discoveryError?: string }
