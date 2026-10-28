#include "MemoryProbe.h"
#include <errno.h>
#include <libproc.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/sysctl.h>

static const size_t MH_PID_HEADROOM = 256;
static const size_t MH_MAX_PROCESSES = 131072;

int mh_sample_system(MHSystemMemory *result) {
    if (result == NULL) return EINVAL;
    MHSystemMemory sample = {0};
    size_t total_size = sizeof(sample.total_bytes);
    if (sysctlbyname("hw.memsize", &sample.total_bytes, &total_size, NULL, 0) != 0) {
        return errno;
    }
    struct xsw_usage swap = {0};
    size_t swap_size = sizeof(swap);
    if (sysctlbyname("vm.swapusage", &swap, &swap_size, NULL, 0) != 0) {
        return errno;
    }
    sample.swap_used_bytes = swap.xsu_used;
    sample.pressure_dispatch_value = UINT32_MAX;
    size_t pressure_size = sizeof(sample.pressure_dispatch_value);
    if (sysctlbyname("kern.memorystatus_vm_pressure_level", &sample.pressure_dispatch_value,
                     &pressure_size, NULL, 0) != 0) {
        /* An unavailable pressure signal must never be reported as normal. */
        sample.pressure_dispatch_value = UINT32_MAX;
    }
    *result = sample;
    return 0;
}

static int list_process_ids(pid_t **result, size_t *count) {
    const int required_bytes = proc_listpids(PROC_ALL_PIDS, 0, NULL, 0);
    if (required_bytes <= 0) return errno != 0 ? errno : EIO;
    const size_t capacity = (size_t)required_bytes / sizeof(pid_t) + MH_PID_HEADROOM;
    if (capacity > MH_MAX_PROCESSES) return EOVERFLOW;
    pid_t *pids = calloc(capacity, sizeof(pid_t));
    if (pids == NULL) return ENOMEM;
    const int copied_bytes = proc_listpids(PROC_ALL_PIDS, 0, pids, (int)(capacity * sizeof(pid_t)));
    if (copied_bytes <= 0 || (size_t)copied_bytes >= capacity * sizeof(pid_t)) {
        const int failure = copied_bytes <= 0 ? (errno != 0 ? errno : EIO) : EAGAIN;
        free(pids);
        return failure;
    }
    *result = pids;
    *count = (size_t)copied_bytes / sizeof(pid_t);
    return 0;
}

int mh_sample_processes(MHProcessRecord **records, size_t *count, size_t *unreadable) {
    if (records == NULL || count == NULL || unreadable == NULL) return EINVAL;
    *records = NULL;
    *count = 0;
    *unreadable = 0;
    pid_t *pids = NULL;
    size_t pid_count = 0;
    const int list_error = list_process_ids(&pids, &pid_count);
    if (list_error != 0) return list_error;
    MHProcessRecord *samples = calloc(pid_count, sizeof(MHProcessRecord));
    if (samples == NULL) {
        free(pids);
        return ENOMEM;
    }
    size_t sample_count = 0;
    size_t failures = 0;
    for (size_t index = 0; index < pid_count; index++) {
        if (pids[index] <= 0) continue;
        char executable_path[MH_PATH_CAPACITY] = {0};
        if (proc_pidpath(pids[index], executable_path, sizeof(executable_path)) <= 0) {
            failures++;
            continue;
        }
        struct rusage_info_v4 usage = {0};
        if (proc_pid_rusage(pids[index], RUSAGE_INFO_V4, (rusage_info_t *)&usage) != 0) {
            failures++;
            continue;
        }
        samples[sample_count].pid = pids[index];
        samples[sample_count].footprint_bytes = usage.ri_phys_footprint;
        memcpy(samples[sample_count].executable_path, executable_path, sizeof(executable_path));
        sample_count++;
    }
    free(pids);
    *records = samples;
    *count = sample_count;
    *unreadable = failures;
    return 0;
}

void mh_free_records(MHProcessRecord *records) {
    free(records);
}
