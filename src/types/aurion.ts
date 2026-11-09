export interface IdRequest {
    email: string;
    password: string;
}

export interface PlanningRequest extends IdRequest {
    startTimestamp: number;
    endTimestamp: number;
}

export interface Person {
    lastName: string;
    firstName: string;
}

export interface EventGroup {
    code: string;
    label: string;
}

export interface EventDetails {
    teachers: Person[];
    students: Person[];
    groups: EventGroup[];
}

export interface EventDetailsRequest extends IdRequest {
    title: string;
    start: string;
    end: string;
}
