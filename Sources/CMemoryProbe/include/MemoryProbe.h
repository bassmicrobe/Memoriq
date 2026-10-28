#ifndef MEMORY_PROBE_H
#define MEMORY_PROBE_H
#include <stddef.h>
#include <stdint.h>

#define MH_PATH_CAPACITY 4096

typedef struct {
    int32_t pid;
    uint64_t footprint_bytes;
    char executable_path[MH_PATH_CAPACITY];
} MHProcessRecord;

typedef struct {
    uint64_t total_bytes;
    uint64_t swap_used_bytes;
    uint32_t pressure_dispatch_value;
} MHSystemMemory;

/* These functions only observe memory. No process-control API is used. */
int mh_sample_system(MHSystemMemory *result);
int mh_sample_processes(MHProcessRecord **records, size_t *count, size_t *unreadable);
void mh_free_records(MHProcessRecord *records);
#endif
