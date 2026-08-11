const config = {
    term: '202601',
    dataVersion: 82
};

config.infoLink = `https://suis.sabanciuniv.edu/prod/bwckschd.p_disp_detail_sched?term_in=${config.term}&crn_in=`;
Object.freeze(config);

const templateGenerator = (() => {
    const getDayFromCode = (() => {
        // const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'TBA'];
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'TBA'];

        return dayCode => {
            return days[dayCode];
        };
    })();

    const getScheduleHours = (start, duration) => {
        if (start === -1) return 'TBA';

        start += 8;

        const end = start + duration;

        return `${start < 10 ? '0' : ''}${start}:40-${end < 10 ? '0' : ''}${end}:30`;
    };

    const makeCourseEntry = (course, instructors, places) => `
        <div class="course-entry hide-info" data-code="${course.code}">
            <div class="course-header">
                <div class="course-name">${course.code} - ${course.name}</div>
                <div class="course-expand icon-right-open-big"></div>
            </div>
            <div class="course-info">
            ${course.classes.map(_class => `
                <div class="course-sections">
                    <div class="section-type">Sections${_class.type ? ` (${_class.type})` : ``}</div>
                ${_class.sections.map(section => `
                    <div class="course-section" 
                        data-section-name="${course.code.replace(' ', '')}${_class.type} - ${section.group}"
                        data-crn="${section.crn}">
                    <div class="section-info">
                        <div class="section-header">
                            <div class="section-group" data-group="${section.group}">${section.group}</div>
                            <a href="${config.infoLink}${section.crn}" class="section-link" target="_blank">info</a>
                        </div>
                        <div class="instructor">${instructors[section.instructors]}</div>
                        <div class="section-days">
                        ${section.schedule.map(schedule => `
                            <div class="section-day" 
                                data-day="${schedule.day}"
                                data-start="${schedule.start}" 
                                data-duration="${schedule.duration}"
                                data-place="${places[schedule.place]}">
                                ${getDayFromCode(schedule.day)} ${getScheduleHours(schedule.start, schedule.duration)} ${places[schedule.place]}
                            </div>
                        `).join('')}
                        </div>
                    </div>
                    <div class="section-button"></div>
                    </div>
                `).join('')}
                </div>
            `).join('')}
            </div>
        </div>
    `;

    const makeCellCourse = (sectionName, crn, bgColor = 'azure') => `
        <div class="cell-course" data-crn="${crn}" data-section-name="${sectionName}"
            style="background-color: ${bgColor};">
            <div>${sectionName}</div>
            <div class="remove-course"></div>
        </div>
    `;

    //  Plan names are user typed, so they go through the DOM rather than into the markup.
    const escapeHtml = text => $('<div>').text(text).html();

    const makeScenarioTab = (plan, index, isActive, isNew) => `
        <div class="scenario-tab${isActive ? ' active' : ''}${isNew ? ' entering' : ''}"
            data-scenario="${index}" draggable="true">
            <span class="scenario-tab-name" title="Double click to rename">${escapeHtml(plan.name)}</span>
            <span class="scenario-tab-close" title="Close this plan">&times;</span>
        </div>
    `;

    const makeScenarioAddButton = () => `<div id="scenario-add" title="New plan">+</div>`;

    return {
        makeCourseEntry,
        makeCellCourse,
        makeScenarioTab,
        makeScenarioAddButton
    };
})();

const colorPalette = (() => {
    let colors = [
        '#2096BA',
        '#C5919D',
        '#DF6E21',
        '#874E4C',
        '#32485C',
        '#765285',
        '#351C4D',
        '#FF7E5F',
        '#726A95',
        '#849974',
        '#36384C',
        '#F26968',
        '#F2AD9F',
        '#6CBF84',
        '#323339',
        '#AB3E16',
        '#EFAA52',
        '#48120E',
        '#B37C57',
        '#9AACB8'
    ];
    const initial = colors.slice(0);

    return {
        getColor: () => colors.splice(Math.floor(Math.random() * colors.length), 1).shift() || 'azure',
        putColor: color => color === 'azure' ? null : colors.push(color),
        reset: () => colors = initial.slice(0)
    };
})();

const scenarios = (() => {
    const MAX = 5;
    const LETTERS = 'ABCDE';

    //  The key has to contain 'saved-schedule': clearOldData in updateCourseData wipes
    //  every key matching that substring when the course data changes, which is what
    //  keeps stale crns out of the saved plans.
    const storageKey = 'saved-schedules';

    let plans = [];
    let pendingClose = null;

    const write = () => localStorage.setItem(storageKey, JSON.stringify(plans));

    const count = () => plans.length;

    const nextName = () => {
        for (const letter of LETTERS) {
            if (!plans.some(plan => plan.name === `Plan ${letter}`)) {
                return `Plan ${letter}`;
            }
        }

        return `Plan ${plans.length + 1}`;
    };

    const getActiveIndex = () => {
        const stored = Number(localStorage.getItem('active-scenario')) || 0;

        return stored >= 0 && stored < plans.length ? stored : 0;
    };

    const getName = index => plans[index].name;

    const getActiveName = () => getName(getActiveIndex());

    const crnCount = index => {
        const crns = plans[index].crns;

        return crns === '' ? 0 : crns.split(',').length;
    };

    const saveActive = crns => {
        plans[getActiveIndex()].crns = crns;

        write();
    };

    //  Only called when the plan list itself changes. Switching tabs merely moves the
    //  active class, so the elements keep their identity and dblclick-to-rename survives.
    //  enteringIndex marks the one tab that should play its entry animation.
    const renderTabs = (enteringIndex = -1) => {
        const activeIndex = getActiveIndex();

        $('#scenario-tabs')
            .toggleClass('single-plan', plans.length === 1)
            .html(
                plans.map((plan, index) =>
                    templateGenerator.makeScenarioTab(plan, index, index === activeIndex, index === enteringIndex))
                    .join('') + (plans.length < MAX ? templateGenerator.makeScenarioAddButton() : '')
            );
    };

    const markActiveTab = () => {
        $('.scenario-tab').removeClass('active')
            .filter(`[data-scenario="${getActiveIndex()}"]`).addClass('active');
    };

    //  Deliberately does not save: switching tabs resets the table before loading the
    //  target plan, and saving in between would overwrite that plan with an empty one.
    const clearScheduleDom = () => {
        $('.course-section.selected').removeClass('selected');
        $('.class-cell').attr('class', 'class-cell').children().remove();

        colorPalette.reset();
    };

    const load = index => {
        if (plans[index].crns === '') {
            return;
        }

        plans[index].crns.split(',').forEach(crn => {
            $(`.course-section[data-crn="${crn}"]`).click();
        });
    };

    const switchTo = index => {
        //  Set first: the clicks below run through addToSchedule, which saves to the active plan.
        localStorage.setItem('active-scenario', index);

        markActiveTab();

        if (courseEntry.isOnDisplayMode()) {
            courseEntry.endDisplayMode();
        }

        clearScheduleDom();

        load(index);

        //  Switching to an empty plan produces no clicks at all, so the conflict filter
        //  would keep hiding sections based on the plan we just left.
        sectionEntry.filterByConflicts();
    };

    const add = (crns = '') => {
        if (plans.length >= MAX) {
            return getActiveIndex();
        }

        plans.push({name: nextName(), crns});

        write();
        renderTabs(plans.length - 1);

        switchTo(plans.length - 1);

        return plans.length - 1;
    };

    //  The tab plays its exit animation before the list actually changes, so the
    //  remaining tabs only reflow once, after it is gone.
    const close = index => {
        const $tab = $(`.scenario-tab[data-scenario="${index}"]`);

        if (plans.length <= 1 || $tab.hasClass('leaving')) {
            return;
        }

        const remove = () => {
            const activeIndex = getActiveIndex();

            plans.splice(index, 1);

            write();
            renderTabs();

            switchTo(index < activeIndex ? activeIndex - 1 : Math.min(activeIndex, plans.length - 1));
        };

        if ($tab.length === 0) {
            remove();

            return;
        }

        $tab.addClass('leaving');

        setTimeout(remove, 160);
    };

    const move = (from, to) => {
        if (from === to || plans[from] === undefined || plans[to] === undefined) {
            return;
        }

        //  Tracked by identity so the same plan stays active wherever it lands.
        const activePlan = plans[getActiveIndex()];

        plans.splice(to, 0, plans.splice(from, 1).shift());

        localStorage.setItem('active-scenario', plans.indexOf(activePlan));

        write();
        renderTabs();
    };

    const requestClose = index => {
        if (plans.length <= 1) {
            return;
        }

        if (crnCount(index) === 0) {
            close(index);

            return;
        }

        pendingClose = index;

        $('#notify-close-plan .notification-content p').text(
            `${getName(index)} has ${crnCount(index)} course${crnCount(index) === 1 ? '' : 's'} in it.` +
            ` Closing it cannot be undone.`
        );

        $('#notify-close-plan').fadeIn(500);
    };

    const confirmClose = () => {
        if (pendingClose === null) {
            return;
        }

        close(pendingClose);

        pendingClose = null;
    };

    const rename = (index, name) => {
        plans[index].name = name.replace(/\s+/g, ' ').trim().slice(0, 24) || nextName();

        write();
        renderTabs();
    };

    const replaceActive = crns => {
        plans[getActiveIndex()].crns = crns;

        write();

        switchTo(getActiveIndex());
    };

    //  Runs at definition time so the plan list is ready for anything that reads it
    //  before the DOM work starts - shareLink.offerImport in particular.
    (migrate = () => {
        try {
            plans = JSON.parse(localStorage.getItem(storageKey)) || [];
        } catch (error) {
            plans = [];
        }

        plans = (Array.isArray(plans) ? plans : [])
            .filter(plan => plan !== null && typeof plan === 'object' && typeof plan.crns === 'string')
            .map(plan => ({name: String(plan.name || ''), crns: plan.crns}));

        if (plans.length === 0) {
            //  Older layouts: three fixed plans, and before those a single schedule.
            plans = ['saved-schedule-0', 'saved-schedule-1', 'saved-schedule-2', 'saved-schedule']
                .map(key => localStorage.getItem(key))
                .filter(crns => crns !== null && crns !== '')
                .map((crns, index) => ({name: `Plan ${LETTERS[index]}`, crns}));
        }

        if (plans.length === 0) {
            plans = [{name: `Plan ${LETTERS[0]}`, crns: ''}];
        }

        plans = plans.slice(0, MAX);

        ['saved-schedule', 'saved-schedule-0', 'saved-schedule-1', 'saved-schedule-2']
            .forEach(key => localStorage.removeItem(key));

        write();
    })();

    return {
        MAX, count, nextName, getActiveIndex, getName, getActiveName, crnCount, saveActive,
        clearScheduleDom, renderTabs, switchTo, add, requestClose, confirmClose, rename, replaceActive, move
    };
})();

const saveSchedule = () => {
    scenarios.saveActive(cellCourses.getAllCrnDataToSave().join(','));
};

const courseEntry = (() => {
    const courseEntry = function (codeOr$element) {
        if (!(codeOr$element instanceof $)) {
            return courseEntry.findByCode(codeOr$element);
        }

        return new courseEntry.prototype.Init(codeOr$element);
    };

    courseEntry.prototype.Init = function ($element) {
        this.getElement = function () {
            return $element.first();
        };

        return this;
    };

    courseEntry.prototype.Init.prototype = courseEntry.prototype;

    courseEntry.prototype.isOpen = function () {
        return !this.getElement().hasClass('hide-info');
    };

    courseEntry.prototype.open = function () {
        this.getElement().removeClass('hide-info');

        this.getElement().siblings(':not(hide-info)').addClass('hide-info');

        this.updateSelectionsOnSchedule();

        return this;
    };

    courseEntry.prototype.close = function () {
        this.getElement().addClass('hide-info');

        this.hideSelectionsOnSchedule();

        return this;
    };

    courseEntry.prototype.toggleOpen = function () {
        this.isOpen() ? this.close() : this.open();

        return this;
    };

    courseEntry.prototype.getCodeWithSpace = function () {
        return this.getElement().data('code');
    };

    courseEntry.prototype.getCodeWithoutSpace = function () {
        return this.getElement().data('code').replace(/ /g, '');
    };

    courseEntry.prototype.getName = function () {
        return this.getElement().find('.course-name').text();
    };

    //  Only the first 3 digits carry the level: special topic courses are numbered
    //  with 4 or 5 digits (CS 48012, EE 4801), so the raw number would misclassify them.
    courseEntry.prototype.getCourseLevel = function () {
        const number = this.getCodeWithSpace().replace(/^[A-Z]+\s*(\d+).*$/, '$1');

        return Number(number.slice(0, 3));
    };

    courseEntry.prototype.isGraduate = function () {
        return this.getCourseLevel() >= 500;
    };

    courseEntry.prototype.showSelectionsOnSchedule = function () {
        this.getSections('.course-section.selected').forEach(section => {
            section.getClassCells().getElements().addClass('selection');
        });

        return this;
    };

    courseEntry.prototype.hideSelectionsOnSchedule = function () {
        $('.class-cell').removeClass('selection');

        return this;
    };

    courseEntry.prototype.updateSelectionsOnSchedule = function () {
        this.hideSelectionsOnSchedule();

        if (this.isOpen() && !this.isSelectionComplete()) {
            this.showSelectionsOnSchedule();
        }

        return this;
    };

    courseEntry.prototype.addFilter = function (filterName) {
        this.getElement().addClass(`filter-hide-${filterName}`);

        return this;
    };

    courseEntry.prototype.removeFilter = function (filterName) {
        this.getElement().removeClass(`filter-hide-${filterName}`);

        return this;
    };

    courseEntry.prototype.nameContains = function (query) {
        let name = this.getName();
        name = name.replaceAll(/\s+/g, '').toUpperCase();
        return name.indexOf(query) > -1;
    };

    courseEntry.prototype.isSelectionComplete = function () {
        return this.getElement().find('.selected').length === this.getElement().find('.course-sections').length;
    };

    courseEntry.prototype.isMainCourseSelected = function () {
        return this.getElement().find('.course-sections:first .selected').length > 0;
    };

    courseEntry.prototype.getSections = function (selector = '.course-section') {
        return $.map(this.getElement().find(selector), section => sectionEntry($(section)));
    };

    courseEntry.prototype.getCellCourseColor = function () {
        return cellCourses.findByCourseCode(this.getCodeWithoutSpace()).getColor();
    };

    courseEntry.prototype.isOnSchedule = function () {
        return cellCourses.findByCourseCode(this.getCodeWithoutSpace()).getElements().length > 0;
    };

    courseEntry.prototype.addToSchedule = function () {
        this.hideSelectionsOnSchedule();

        const color = colorPalette.getColor();

        this.getSections('.course-section.selected').forEach(section => {
            section.getClassCells().addCellCourse(cellCourses.make(section.getName(), section.getCrn(), color));
        });

        saveSchedule();

        sectionEntry.filterByConflicts();

        return this;
    };

    courseEntry.prototype.removeFromSchedule = function () {
        if (this.isOnSchedule()) {
            colorPalette.putColor(this.getCellCourseColor());

            this.getSections().forEach(section => {
                classCells.findContainsCrn(section.getCrn()).removeCellCourse(section.getCrn());
            });
        }

        this.updateSelectionsOnSchedule();

        saveSchedule();

        sectionEntry.filterByConflicts();

        return this;
    };

    courseEntry.prototype.actOnSectionSelected = function () {
        this.updateSelectionsOnSchedule();

        if (this.isSelectionComplete()) {
            this.addToSchedule();
        }

        return this;
    };

    courseEntry.prototype.actOnSectionDeselected = function () {
        this.removeFromSchedule();

        if (this.isMainCourseSelected() && !this.isOpen()) {
            courseEntry.endDisplayMode();
            courseEntry.startDisplayMode(this.getCodeWithSpace());
        }

        return this;
    };

    courseEntry.prototype.hasEmptySection = function () {
        for (const courseSections of this.getElement().find('.course-sections')) {
            if ($(courseSections).find('.course-section:not([class*=filter-hide-])').length === 0) {
                return true;
            }
        }

        return false;
    };

    courseEntry.closeAll = () => {
        $('.course-entry').addClass('hide-info');
    };

    courseEntry.findByCode = code => courseEntry($(`.course-entry[data-code="${code}"]`));

    courseEntry.clearFilter = filterName => {
        $('.course-entry').removeClass(`filter-hide-${filterName}`);
    };

    courseEntry.filter = (filter, filterName) => {
        $('.course-entry').each((i, course) => {
            course = courseEntry($(course));

            filter(course) ? course.removeFilter(filterName) : course.addFilter(filterName);
        });
    };

    courseEntry.filterIfAnyEmptySection = () => {
        courseEntry.filter(
            course => !course.hasEmptySection(),
            'empty-section'
        );
    };

    courseEntry.filterByLevel = () => {
        const mode = $('input[name=level-filter]:checked').val();

        if (mode === 'all') {
            courseEntry.clearFilter('level');

            return;
        }

        courseEntry.filter(
            course => course.isGraduate() === (mode === 'grad'),
            'level'
        );
    };

    courseEntry.startDisplayMode = code => {
        courseEntry(code).open().getElement().addClass('display-alone');

        $('#menu').addClass('display-mode');

        $('body').removeClass('hide-menu');
    };

    courseEntry.endDisplayMode = () => {
        courseEntry($('.display-alone')).close().getElement().removeClass('display-alone');

        $('#menu').removeClass('display-mode');
    };

    courseEntry.isOnDisplayMode = () => $('#menu').hasClass('display-mode');

    courseEntry.make = (course, instructors) => courseEntry(templateGenerator.makeCourseEntry(course, instructors));

    courseEntry.populate = (courses, instructors, places) => {
        const $list = $('#course-list').removeClass('loading');

        courses.forEach(course => {
            $list.append(templateGenerator.makeCourseEntry(course, instructors, places));
        });

        //  Covers the first visit, where the list arrives asynchronously from $.getJSON
        //  and therefore misses the pass done by setLevelFilterEvents.
        courseEntry.filterByLevel();

        shareLink.offerImport();
    };

    return courseEntry;
})();

const sectionEntry = (() => {
    const sectionEntry = function (crnOr$element) {
        if (!(crnOr$element instanceof $)) {
            return sectionEntry.findByCrn(crnOr$element);
        }

        return new sectionEntry.prototype.Init(crnOr$element);
    };

    sectionEntry.prototype.Init = function ($element) {
        this.getElement = function () {
            return $element;
        };

        return this;
    };

    sectionEntry.prototype.Init.prototype = sectionEntry.prototype;

    sectionEntry.prototype.getCrn = function () {
        return this.getElement().data('crn');
    };

    sectionEntry.prototype.getName = function () {
        return this.getElement().data('section-name');
    };

    sectionEntry.prototype.getInstructorName = function () {
        return this.getElement().find('.instructor').text();
    };

    sectionEntry.prototype.instructorNameContains = function (query) {
        return this.getInstructorName().toUpperCase().indexOf(query) > -1;
    };

    sectionEntry.prototype.getGeneralName = function () {
        return this.getName().split(' ', 2).shift();
    };

    sectionEntry.prototype.getCourseCodeWithoutSpace = function () {
        return this.getName().replace(/([A-Z]+)(\d+).*/, '$1$2');
    };

    sectionEntry.prototype.isSelected = function () {
        return this.getElement().hasClass('selected');
    };

    sectionEntry.prototype.deselectAlternatives = function () {
        this.getElement().siblings('.selected').each((i, section) => sectionEntry($(section)).deselect());

        return this;
    };

    sectionEntry.prototype.addFilter = function (filterName) {
        this.getElement().addClass(`filter-hide-${filterName}`);

        return this;
    };

    sectionEntry.prototype.removeFilter = function (filterName) {
        this.getElement().removeClass(`filter-hide-${filterName}`);

        return this;
    };

    sectionEntry.prototype.getCourseEntry = function () {
        return courseEntry(this.getElement().parents('.course-entry'));
    };

    sectionEntry.prototype.getScheduleData = function () {
        return this.getElement().find('.section-day').map((i, el) => ({
            day: $(el).data('day'),
            start: $(el).data('start'),
            duration: $(el).data('duration')
        })).toArray();
    };

    sectionEntry.prototype.getClassCells = function () {
        return classCells($(
            $.map(this.getScheduleData(), schedule =>
                $('#schedule tr').slice(schedule.start + 1, schedule.start + schedule.duration + 1)
                    .find(`td:eq(${schedule.day + 1})`).toArray()
            )
        ));
    };

    sectionEntry.prototype.select = function () {
        this.getElement().addClass('selected');

        this.deselectAlternatives();

        this.getCourseEntry().actOnSectionSelected();

        return this;
    };

    sectionEntry.prototype.deselect = function (shouldNotifyCourseEntry = true) {
        this.getElement().removeClass('selected');

        if (shouldNotifyCourseEntry) {
            this.getCourseEntry().actOnSectionDeselected();
        }

        return this;
    };

    sectionEntry.prototype.toggleSelect = function () {
        this.isSelected() ? this.deselect() : this.select();

        return this;
    };

    sectionEntry.findByCrn = crn => sectionEntry($(`.course-section[data-crn="${crn}"]:first`));

    sectionEntry.clearFilter = (filterName, checkForEmptySections = true) => {
        $('.course-section').removeClass(`filter-hide-${filterName}`);

        if (checkForEmptySections) courseEntry.filterIfAnyEmptySection();
    };

    sectionEntry.filter = (filter, filterName, checkForEmptySections = true) => {
        $('.course-section').each((i, section) => {
            section = sectionEntry($(section));

            filter(section) ? section.removeFilter(filterName) : section.addFilter(filterName);
        });

        if (checkForEmptySections) courseEntry.filterIfAnyEmptySection();
    };

    sectionEntry.filterByDays = () => {
        let allowedDays = [];

        $('#day-filter-selections input').each((i, checkbox) => {
            if ($(checkbox).is(':checked')) {
                allowedDays.push(i);
            }
        });

        //  TODO: Fix. This is a hack to always include courses with TBA days
        allowedDays.push(5);

        sectionEntry.filter(
            section => {
                for (const sectionDay of section.getElement().find('.section-day')) {
                    if (allowedDays.indexOf(Number($(sectionDay).data('day'))) === -1) {
                        return false;
                    }
                }

                return true;
            },
            'day'
        );
    };

    //  Maps every schedule cell that holds a course to the set of course codes sitting in it.
    //  Keys are `${row}-${column}` of #schedule, matching the arithmetic of getClassCells.
    sectionEntry.getOccupiedSlots = () => {
        const slots = {};

        $('.cell-course').each((i, element) => {
            const $cell = $(element).parent();
            const key = `${$cell.parent().index()}-${$cell.index()}`;
            const code = cellCourses($(element)).getCourseCodeWithoutSpace();

            (slots[key] = slots[key] || {})[code] = 1;
        });

        return slots;
    };

    sectionEntry.filterByConflicts = (() => {
        const apply = () => {
            if (!$('#conflict-filter-toggle').is(':checked')) {
                sectionEntry.clearFilter('conflict');

                return;
            }

            const occupiedSlots = sectionEntry.getOccupiedSlots();

            sectionEntry.filter(
                section => {
                    //  A selected section always stays visible, otherwise it could not be removed anymore.
                    if (section.isSelected()) {
                        return true;
                    }

                    const courseCode = section.getCourseCodeWithoutSpace();

                    for (const sectionDay of section.getElement().find('.section-day')) {
                        const day = Number($(sectionDay).data('day'));
                        const start = Number($(sectionDay).data('start'));
                        const duration = Number($(sectionDay).data('duration'));

                        //  TBA hours cannot conflict with anything
                        if (start === -1) {
                            continue;
                        }

                        for (let hour = start; hour < start + duration; hour++) {
                            const codes = occupiedSlots[`${hour + 1}-${day + 1}`];

                            if (codes === undefined) {
                                continue;
                            }

                            //  Hours taken by the section's own course are not a conflict.
                            for (const occupyingCode of Object.keys(codes)) {
                                if (occupyingCode !== courseCode) {
                                    return false;
                                }
                            }
                        }
                    }

                    return true;
                },
                'conflict'
            );
        };

        //  Adding a saved schedule fires one call per course, so consecutive calls are merged into one pass.
        let scheduledRun = null;

        return () => {
            if (scheduledRun !== null) {
                return;
            }

            scheduledRun = setTimeout(() => {
                scheduledRun = null;

                apply();
            }, 0);
        };
    })();

    return sectionEntry;
})();

const cellCourses = (() => {
    const cellCourses = function (crnOr$element) {
        if (!(crnOr$element instanceof $)) {
            return cellCourses.findByCrn(crnOr$element);
        }

        return new cellCourses.prototype.Init(crnOr$element);
    };

    cellCourses.prototype.Init = function ($elements) {
        this.getElements = function () {
            return $elements;
        };

        return this;
    };

    cellCourses.prototype.Init.prototype = cellCourses.prototype;

    cellCourses.prototype.getSectionName = function () {
        return this.getElements().first().data('section-name');
    };

    cellCourses.prototype.getCourseCodeWithSpace = function () {
        return this.getSectionName().replace(/([A-Z]+)(\d+).*/, '$1 $2');
    };

    cellCourses.prototype.getCourseCodeWithoutSpace = function () {
        return this.getSectionName().replace(/([A-Z]+)(\d+).*/, '$1$2');
    };

    cellCourses.prototype.getParentClassCells = function () {
        return classCells(this.getElements().parent());
    };

    cellCourses.prototype.isOfMainCourse = function () {
        return /^[A-Z]+\d+ .*$/.test(this.getSectionName());
    };

    cellCourses.prototype.animateCloseButtons = function (propagate = true) {
        if (propagate && this.isOfMainCourse()) {
            cellCourses.findByCourseCode(this.getCourseCodeWithoutSpace()).animateCloseButtons(false);
        }

        this.getElements().addClass('animate');

        return this;
    };

    cellCourses.prototype.getColor = function () {
        return this.getElements().first().css('background-color');
    };

    cellCourses.getAllCrnDataToCopy = () => {
        const crnObj = {};
        let results = [];

        $('.cell-course').each((i, element) => {
            const crn = $(element).data('crn');

            if (!crnObj.hasOwnProperty(crn)) {
                results.push(`${$(element).data('section-name')}: ${crn}`);
            }

            crnObj[$(element).data('crn')] = 1;
        });

        return results.sort().join('\n');
    };

    cellCourses.getAllCrnDataToSave = () => {
        const crnObj = {};

        $('.cell-course').each((i, element) => {
            crnObj[$(element).data('crn')] = 1;
        });

        return Object.keys(crnObj);
    };

    cellCourses.findByCrn = crn => cellCourses($(`.cell-course[data-crn="${crn}"]`));

    cellCourses.findByGeneralSectionName = name => cellCourses($(`.cell-course[data-section-name^="${name}"]`));

    cellCourses.findByCourseCode = code => cellCourses($(`.cell-course[data-section-name^="${code}"]`));

    cellCourses.make = (sectionName, crn, bgColor) => {
        return cellCourses($(templateGenerator.makeCellCourse(sectionName, crn, bgColor)));
    };

    return cellCourses;
})();

const classCells = (() => {
    const classCells = function (crnOr$elements) {
        if (!(crnOr$elements instanceof $)) {
            return classCells.findContainsCrn(crnOr$elements)
        }

        return new classCells.prototype.Init(crnOr$elements);
    };

    classCells.prototype.Init = function ($elements) {
        this.getElements = function () {
            return $elements;
        };

        return this;
    };

    classCells.prototype.Init.prototype = classCells.prototype;

    classCells.prototype.getElementsByChildrenCount = function (count) {
        return $(
            $.map(this.getElements(), element => {
                if ($(element).children().length === count) {
                    return element;
                }
            })
        );
    };

    classCells.prototype.addCellCourse = function (cellCourse) {
        this.getElements().addClass('filled').append(cellCourse.getElements().first().clone());

        this.getElementsByChildrenCount(1).addClass('make-available');

        return this;
    };

    classCells.prototype.removeCellCourse = function (crn) {
        cellCourses.findByCrn(crn).getElements().remove();

        this.getElementsByChildrenCount(0).removeClass('filled');

        return this;
    };

    classCells.clearInterests = () => {
        $('.interested').removeClass('interested').removeClass('make-available');
    };

    classCells.findContainsCrn = crn => classCells($('.class-cell').has(`[data-crn="${crn}"]`));

    return classCells;
})();

const shareLink = (() => {
    const make = () => {
        const crns = cellCourses.getAllCrnDataToSave();

        return `${location.origin}${location.pathname}#term=${config.term}&crns=${crns.join(',')}`;
    };

    const parse = () => {
        const crnsMatch = location.hash.match(/crns=([\d,]+)/);
        const termMatch = location.hash.match(/term=(\d+)/);

        if (crnsMatch === null) {
            return null;
        }

        return {
            term: termMatch === null ? null : termMatch[1],
            //  A repeated crn would click the same section twice and toggle it back off.
            crns: [...new Set(crnsMatch[1].split(',').filter(crn => crn.length > 0))]
        };
    };

    //  A shared schedule gets its own plan, so nothing the visitor built is touched.
    //  Only when every plan slot is taken does it fall back to replacing the active one.
    const resolveTarget = () => {
        if (scenarios.count() < scenarios.MAX) {
            return {isNew: true, name: scenarios.nextName()};
        }

        const index = scenarios.getActiveIndex();

        return {isNew: false, name: scenarios.getName(index), courses: scenarios.crnCount(index)};
    };

    const notify = (id, text) => {
        $(`#${id} .notification-content p`).text(text);

        $(`#${id}`).fadeIn(500);
    };

    let pending = null;

    //  Called from courseEntry.populate, which is the one point both the synchronous and
    //  the $.getJSON path go through. Anywhere else and a first-time visitor - which is
    //  exactly who opens a shared link - would find no .course-section to match against.
    const offerImport = () => {
        const shared = parse();

        if (shared === null) {
            return;
        }

        if (shared.term !== null && shared.term !== config.term) {
            notify('notify-share-invalid',
                `This link is for term ${shared.term}, but the current term is ${config.term}. ` +
                `Ask for a fresh link.`);

            return;
        }

        const found = shared.crns.filter(crn => $(`.course-section[data-crn="${crn}"]`).length > 0);
        const missing = shared.crns.length - found.length;

        if (found.length === 0) {
            notify('notify-share-invalid',
                `None of the ${shared.crns.length} courses in this link exist in term ${config.term}.`);

            return;
        }

        const target = resolveTarget();

        pending = found;

        notify('notify-share-import',
            `Someone shared a schedule of ${found.length} course${found.length === 1 ? '' : 's'} with you.` +
            `${missing > 0 ? ` ${missing} of them could not be found in this term.` : ''}` +
            (target.isNew
                ? ` Load it into a new plan (${target.name})?`
                : ` All ${scenarios.MAX} plans are in use, so this will replace ${target.name}` +
                  ` (${target.courses} course${target.courses === 1 ? '' : 's'}). Load it anyway?`));
    };

    const acceptImport = () => {
        if (pending === null) {
            return;
        }

        //  Resolved again rather than reused: the visitor may have added or closed a plan
        //  while the confirmation was sitting on screen.
        resolveTarget().isNew ? scenarios.add(pending.join(',')) : scenarios.replaceActive(pending.join(','));

        pending = null;

        //  Without this the confirmation comes back on every reload and fights the user's own edits.
        history.replaceState(null, '', location.pathname);
    };

    return {make, parse, offerImport, acceptImport};
})();

(showFirstVisitNotifications = () => {
    if (localStorage.getItem('visited-before') === null) {
        localStorage.setItem('visited-before', 'yes');

        $('#notify-about').show();
        $('#notify-cookies').show();
    }
})();

(updateCourseData = () => {
    const storageKey = `course-data-${config.term}-${config.dataVersion}`;
    const data = localStorage.getItem(storageKey);

    const showNotification = () => {
        $('#notify-data-updated').fadeIn(500);
    };

    

    const clearOldData = () => {
        let removedData = false;

        for (let i = 0; ; i++) {
            const key = localStorage.key(i);

            if (key === null) {
                break;
            }

            if (key.indexOf('course-data') > -1 || key.indexOf('saved-schedule') > -1) {
                localStorage.removeItem(key);

                removedData = true;
            }
        }

        if (removedData) {
            showNotification();
        }
    };

    if (data !== null) {
        const {courses, instructors, places} = JSON.parse(data);

        courseEntry.populate(courses, instructors, places);

        return;
    }

    $.getJSON(`data-v${config.dataVersion}.min.json`, data => {
        const {courses, instructors, places} = data;

        clearOldData();

        courseEntry.populate(courses, instructors, places);

        localStorage.setItem(storageKey, JSON.stringify(data));
    });
})();

(setLevelFilterEvents = () => {
    const storageKey = 'level-filter';
    const mode = localStorage.getItem(storageKey) || 'all';

    $(`input[name=level-filter][value="${mode}"]`).prop('checked', true);

    $(document).on('change', 'input[name=level-filter]', event => {
        localStorage.setItem(storageKey, $(event.currentTarget).val());

        courseEntry.filterByLevel();
    });

    //  Covers the repeat visit, where updateCourseData has already populated the list synchronously.
    courseEntry.filterByLevel();
})();

const normalizeSearchParam = (query) => {
        query = query.trim().toUpperCase();
        query = query.replaceAll(/\s+/g, '');
        
        return query;
};

(setEvents = () => {
    let draggedIndex = null;

    $(document).on('click', '.course-header', event => {
        courseEntry($(event.currentTarget).parent()).toggleOpen();

        if (courseEntry.isOnDisplayMode()) {
            courseEntry.endDisplayMode();
        }
    });

    $(document).on('click', '.section-link', event => {
        event.stopPropagation();
    });

    $(document).on('click', '.course-section', event => {
        sectionEntry($(event.currentTarget)).toggleSelect();
    });

    $(document).on('click', '.remove-course', event => {
        sectionEntry($(event.currentTarget).parent().data('crn')).toggleSelect();

        event.stopPropagation();
    });

    $(document).on('mouseenter', '.remove-course,.course-section.selected', event => {
        cellCourses($(event.currentTarget).closest('[data-crn]').data('crn')).animateCloseButtons();
    });

    $(document).on('mouseleave', '.remove-course,.course-section.selected', event => {
        $('.cell-course.animate').removeClass('animate');

        event.stopPropagation();
    });

    $(document).on('click', '.cell-course', event => {
        courseEntry.startDisplayMode(cellCourses($(event.currentTarget)).getCourseCodeWithSpace());
    });

    $(document).on('mouseenter', '.course-section', event => {
        const section = sectionEntry($(event.currentTarget));

        section.getClassCells().getElements().addClass('interested');

        cellCourses.findByGeneralSectionName(section.getGeneralName()).getParentClassCells().getElements()
            .filter('.interested').addClass('make-available');
    });

    $(document).on('mouseleave', '.course-section', () => {
        classCells.clearInterests();
    });

    const searchParameterChange = event => {
        courseEntry.closeAll();

        const filterName = 'search';

        const searchQuery = (normalizeSearchParam($('#search-box').val() || '') || '');

        switch ($('#search-category').val()) {
            case 'name':
                courseEntry.filter(
                    course => course.nameContains(searchQuery),
                    filterName
                );
                sectionEntry.clearFilter(filterName);
                break;
            case 'instructor':
                courseEntry.clearFilter(filterName);
                sectionEntry.filter(
                    section => section.instructorNameContains(searchQuery),
                    filterName
                );
                break;
        }
    };

    $('#search-category').on('change', searchParameterChange);

    $('#search-box').on('input', searchParameterChange);

    $('#menu-toggle').on('click', () => $('body').toggleClass('hide-menu'));

    //  Pasting a share link while already on the site only changes the hash, so the page
    //  never reloads and populate never runs again.
    $(window).on('hashchange', () => shareLink.offerImport());

    //  Bound straight to the element on purpose: ClipboardJS delegates from document.body,
    //  so stopping propagation here is what keeps an empty schedule from being copied.
    $('#share-button').on('click', event => {
        if (cellCourses.getAllCrnDataToSave().length > 0) {
            return;
        }

        event.stopPropagation();

        $('#notify-share-empty').fadeIn(500);
    });

    $(document).on('keyup', (() => {
        const ESC_KEY = 27;

        return event => {
            if (event.keyCode === ESC_KEY) {
                if (courseEntry.isOnDisplayMode()) {
                    courseEntry.endDisplayMode();
                } else {
                    $('#search-box').val('').trigger('input');
                }
            }
        };
    })());

    //  Skipping the already active tab is what lets dblclick-to-rename work: re-running
    //  switchTo on every click would be harmless, but a second click must not race the rename.
    $(document).on('click', '.scenario-tab', event => {
        const index = Number($(event.currentTarget).data('scenario'));

        if (index !== scenarios.getActiveIndex()) {
            scenarios.switchTo(index);
        }
    });

    $(document).on('click', '#scenario-add', () => scenarios.add());

    $(document).on('click', '.scenario-tab-close', event => {
        event.stopPropagation();

        scenarios.requestClose(Number($(event.currentTarget).closest('.scenario-tab').data('scenario')));
    });

    $(document).on('dblclick', '.scenario-tab-name', event => {
        //  Dragging inside a contenteditable has to select text, not reorder the tab.
        $(event.currentTarget).closest('.scenario-tab').attr('draggable', 'false');

        $(event.currentTarget).attr('contenteditable', 'true').focus();

        document.execCommand('selectAll', false, null);
    });

    $(document).on('dragstart', '.scenario-tab', event => {
        draggedIndex = Number($(event.currentTarget).data('scenario'));

        //  Firefox refuses to start a drag unless some data is set.
        event.originalEvent.dataTransfer.setData('text/plain', String(draggedIndex));
        event.originalEvent.dataTransfer.effectAllowed = 'move';

        $(event.currentTarget).addClass('dragging');
    });

    $(document).on('dragover', '.scenario-tab', event => {
        if (draggedIndex === null) {
            return;
        }

        event.preventDefault();

        event.originalEvent.dataTransfer.dropEffect = 'move';

        const index = Number($(event.currentTarget).data('scenario'));

        $('.scenario-tab').removeClass('drop-before drop-after');

        if (index !== draggedIndex) {
            $(event.currentTarget).addClass(index < draggedIndex ? 'drop-before' : 'drop-after');
        }
    });

    $(document).on('drop', '.scenario-tab', event => {
        event.preventDefault();

        if (draggedIndex !== null) {
            scenarios.move(draggedIndex, Number($(event.currentTarget).data('scenario')));
        }
    });

    $(document).on('dragend', '.scenario-tab', () => {
        draggedIndex = null;

        $('.scenario-tab').removeClass('dragging drop-before drop-after');
    });

    $(document).on('blur', '.scenario-tab-name[contenteditable]', event => {
        const $name = $(event.currentTarget);

        $name.removeAttr('contenteditable');

        scenarios.rename(Number($name.closest('.scenario-tab').data('scenario')), $name.text());
    });

    $(document).on('keydown', '.scenario-tab-name[contenteditable]', event => {
        if (event.key === 'Enter') {
            event.preventDefault();

            $(event.currentTarget).blur();
        }

        if (event.key === 'Escape') {
            //  Drop the attribute first so the blur handler above no longer matches and
            //  the half typed name is discarded instead of saved.
            $(event.currentTarget).removeAttr('contenteditable');

            scenarios.renderTabs();
        }
    });

    $(document).on('click', '#clear-button', () => {
        $('#notify-clear .notification-content p')
            .text(`Are you sure you want to clear ${scenarios.getActiveName()}?`);

        $('#notify-clear').fadeIn(500);
    });

    $(document).on('click', '#about-button', () => $('#notify-about').fadeIn(500));
    $(document).on('click', '#about-button', () => $('#notify-cookies').fadeIn(500));
})();

(setWeekdayFilterEvents = () => {
    $(document).on('input', '#day-filter-selections input', event => {
        sectionEntry.filterByDays();
    });

    if ($('#day-filter-selections input:not(:checked)').length > 0) {
        sectionEntry.filterByDays();

        $('#day-filter-selections').show();
    }
})();

(setConflictFilterEvents = () => {
    const storageKey = 'hide-conflicting-courses';

    //  The state has to be restored before the saved schedule is loaded, otherwise
    //  the courses added on load would be filtered against a toggle that looks off.
    $('#conflict-filter-toggle').prop('checked', localStorage.getItem(storageKey) === 'yes');

    $(document).on('input', '#conflict-filter-toggle', event => {
        localStorage.setItem(storageKey, $(event.currentTarget).is(':checked') ? 'yes' : 'no');

        sectionEntry.filterByConflicts();
    });
})();

(loadScheduleFromLocalStorage = () => {
    scenarios.renderTabs();

    scenarios.switchTo(scenarios.getActiveIndex());
})();

(setNotificationEvents = () => {
    $(document).on('click', '.notification .button', event => {
        $(event.target).closest('.notification').fadeOut(500);
    });

    $(document).on('click', '#notify-share-import .notification-button', () => {
        shareLink.acceptImport();
    });

    $(document).on('click', '#notify-close-plan .notification-button', () => {
        scenarios.confirmClose();
    });

    $(document).on('click', '#notify-clear .notification-button', () => {
        scenarios.clearScheduleDom();

        saveSchedule();

        sectionEntry.filterByConflicts();
    });
})();

(initializeClipboardJS = () => {
    const clipboard = new ClipboardJS('#copy-button', {
        text: () => cellCourses.getAllCrnDataToCopy()
    });

    clipboard.on('success', () => {
        const notification = $('#notify-copied');

        notification.fadeIn(500);

        setTimeout(() => {
            notification.fadeOut(500);
        }, 2000);
    });

    clipboard.on('error', event => {
        const notification = $('#notify-copy-fail');

        notification.find('.notification-content p').text(event.text);

        notification.fadeIn(500);
    });

    const shareClipboard = new ClipboardJS('#share-button', {
        text: () => shareLink.make()
    });

    shareClipboard.on('success', () => {
        const notification = $('#notify-share-copied');

        notification.fadeIn(500);

        setTimeout(() => {
            notification.fadeOut(500);
        }, 3000);
    });

    shareClipboard.on('error', event => {
        const notification = $('#notify-copy-fail');

        notification.find('.notification-content p').text(event.text);

        notification.fadeIn(500);
    });
})();
