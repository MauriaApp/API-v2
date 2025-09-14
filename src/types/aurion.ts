export interface IdRequest {
    email: string;
    password: string;
}

export interface PlanningRequest extends IdRequest {
    startTimestamp: number;
    endTimestamp: number;
}
