/**
 * The shape of an incremental read: what came after a cursor, and whether to start over.
 *
 * The cursor was a byte offset into a JSONL file while sessions were kept in them. In the database
 * it is the last `seq` read (`SessionStore.readChanges`); the shape is kept so its readers did not
 * have to change with it.
 */

/** Internal cursor; callers must obtain it from the same trusted storage instance. */
export interface SessionReadCursor {
	identity: string;
	version: string;
	size: number;
	offset: number;
}

export interface SessionRecordChanges<T> {
	cursor: SessionReadCursor;
	reset: boolean;
	records: T[];
}
