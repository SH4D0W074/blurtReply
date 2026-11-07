import type { Lesson, PublicLesson } from './types';

/** Teacher-authored demo fixtures, including transfer answers, are examples—not observed learning outcomes. */
export const LESSONS: Lesson[] = [
  {
    id: 'sampling',
    title: 'A thousand answers. The same blind spot?',
    subject: 'Statistics · everyday inference',
    subtitle: 'Separate who a survey reaches from how many people answer.',
    estimatedMinutes: 6,
    initial: {
      id: 'sampling-initial',
      context: 'A university wants to estimate average weekly exercise across all its students. It recruits volunteers only from members of university sports clubs.',
      prompt: 'It increases responses from 100 to 1,000 using the same recruitment method. Does the larger response count, by itself, remove the risk of recruitment bias?',
      options: [
        { id: 'yes', label: 'A', text: 'Yes' },
        { id: 'no', label: 'B', text: 'No' },
        { id: 'unsure', label: 'C', text: 'I am not sure' },
      ],
    },
    transfer: {
      id: 'sampling-transfer',
      context: 'To estimate average commuting time across a university, Team A surveys 5,000 cycling-club members. Team B samples 200 students uniformly at random from the full enrolment list, and every selected student responds.',
      prompt: 'Which design directly addresses Team A’s coverage limitation? Explain what uncertainty, if any, remains.',
      options: [
        { id: 'team-a', label: 'A', text: 'Team A' },
        { id: 'team-b', label: 'B', text: 'Team B' },
        { id: 'neither', label: 'C', text: 'Neither design' },
        { id: 'unsure', label: 'D', text: 'I am not sure' },
      ],
    },
    initialExpectedChoiceId: 'no',
    transferExpectedChoiceId: 'team-b',
    initialExpectedReasoning: 'Increasing the number recruited through sports clubs does not, by itself, include students outside those clubs. More independent observations can reduce random sampling uncertainty within the recruited population while leaving the coverage limitation. Recruitment bias is a risk; neither its magnitude nor its direction is established here.',
    transferExpectedReasoning: 'Team B gives all enrolled students a chance of selection and directly addresses the club-only sampling frame. Its sample estimate can still vary by chance. This does not guarantee that its particular estimate is closer to the population value than Team A’s.',
    categories: [
      {
        id: 'coverage', label: 'Points to who is missing',
        description: 'Explicitly identifies club-only recruitment or excluded nonmembers as a limitation that a larger response count alone does not remove. Does not assert a position on random sampling uncertainty. Compatible with distinguishes-uncertainty.',
        probeId: 'coverage-probe',
      },
      {
        id: 'distinguishes-uncertainty', label: 'Separates uncertainty from recruitment',
        description: 'Explicitly says more independent observations can reduce random sampling uncertainty, but cannot by themselves fix club-only recruitment. Both claims must be present. Compatible with coverage.',
        probeId: 'random-uncertainty-probe',
      },
      {
        id: 'never-reduces', label: 'Says sample size never reduces random error',
        description: 'Explicitly claims increasing sample size never reduces random error or sampling uncertainty. Do not use for a claim only about recruitment bias. Do not infer this claim from a bare No.',
        probeId: 'random-uncertainty-probe',
      },
      {
        id: 'size-fixes-bias', label: 'Says a larger count fixes recruitment',
        description: 'Explicitly claims a larger response count alone makes club-only recruitment representative of all students or removes that recruitment bias. Do not use for the valid narrower claim that more observations can reduce random uncertainty.',
        probeId: 'coverage-probe',
      },
      {
        id: 'unclear', label: 'Needs a little more explanation',
        description: 'The explanation is too brief, ambiguous, internally conflicting, outside these categories, or does not explicitly support a category. This is not evidence of poor understanding.',
        probeId: 'coverage-probe',
      },
    ],
    probes: [
      {
        id: 'coverage-probe',
        prompt: 'If recruitment still happens only through sports clubs, which students have no opportunity to take part? Does recruiting more club members change that?',
        expectedReasoning: 'Students outside those clubs remain excluded. A larger response count using the same frame does not give those students a chance of selection.',
      },
      {
        id: 'random-uncertainty-probe',
        prompt: 'A simulator repeatedly draws independent random samples from the same population. Some samples have 25 observations and others 100. Which collection of sample means would usually be less spread out, and why?',
        expectedReasoning: 'For independent draws from a population with finite nonzero variance, means of samples of 100 are less spread out. Their standard deviation is half that for samples of 25. This says nothing about fixing an excluded group.',
      },
    ],
    contrastPairs: [
      ['distinguishes-uncertainty', 'never-reduces'],
      ['coverage', 'size-fixes-bias'],
      ['distinguishes-uncertainty', 'size-fixes-bias'],
    ],
    defaultDiscussionPrompt: 'Compare your explanations. What can a larger response count change, and what can it leave unchanged? Use who can enter the sample and variation between repeated samples to explain your answer. You do not have to disagree.',
    demoResponses: [
      {
        alias: 'Amber', choiceId: 'no',
        reason: 'The survey still excludes students outside the clubs, so increasing club responses does not fix that.',
        categoryId: 'coverage',
        quote: 'The survey still excludes students outside the clubs, so increasing club responses does not fix that.',
        transferChoiceId: 'team-b',
        transferReason: 'B samples from the full student list rather than cyclists only. Its estimate can still differ from the population mean by chance.',
      },
      {
        alias: 'Birch', choiceId: 'no',
        reason: 'More independent responses can reduce random uncertainty about club members, but recruitment still excludes other students.',
        categoryId: 'distinguishes-uncertainty',
        quote: 'More independent responses can reduce random uncertainty about club members, but recruitment still excludes other students.',
        transferChoiceId: 'team-b',
        transferReason: 'B addresses who can be selected. Repeating its random sampling would still give different estimates, and this particular estimate is not guaranteed to be closer.',
      },
      {
        alias: 'Cedar', choiceId: 'no',
        reason: 'No, because increasing sample size never reduces random error.',
        categoryId: 'never-reduces',
        quote: 'No, because increasing sample size never reduces random error.',
        transferChoiceId: 'team-b',
        transferReason: 'B includes the full population in its sampling frame. More random observations could reduce sampling uncertainty, but a sample still varies by chance.',
      },
      {
        alias: 'Dune', choiceId: 'no',
        reason: 'No. A thousand people could still be wrong.',
        categoryId: 'unclear',
        quote: 'No. A thousand people could still be wrong.',
        transferChoiceId: 'unsure',
        transferReason: 'I see that B reaches more kinds of students, but I am still unsure how to compare the uncertainty.',
      },
      {
        alias: 'Elm', choiceId: 'yes',
        reason: 'With 1,000 responses the survey becomes representative of all students, even if everyone was recruited through sports clubs.',
        categoryId: 'size-fixes-bias',
        quote: 'With 1,000 responses the survey becomes representative of all students, even if everyone was recruited through sports clubs.',
        transferChoiceId: 'team-b',
        transferReason: 'B gives non-cyclists a chance to be selected as well. The random sample could still happen to have an unusual average commute.',
      },
      {
        alias: 'Fern', choiceId: 'no',
        reason: 'Nonmembers still cannot join this survey. More responses from the same clubs do not include them.',
        categoryId: 'coverage',
        quote: 'Nonmembers still cannot join this survey. More responses from the same clubs do not include them.',
        transferChoiceId: 'team-b',
        transferReason: 'B uses the full list, but that does not guarantee a perfect estimate from only one random sample.',
      },
    ],
  },
  {
    id: 'motion',
    title: 'Moving does not mean being pushed.',
    subject: 'Physics · forces and motion',
    subtitle: 'The same prediction can hide two very different explanations.',
    estimatedMinutes: 6,
    initial: {
      id: 'motion-initial',
      context: 'A puck moves right on an ideal level, frictionless surface. Its motor switches off. Ignore air resistance; there is now no horizontal external force.',
      prompt: 'What happens to the puck’s horizontal velocity while these conditions continue?',
      options: [
        { id: 'constant', label: 'A', text: 'It stays at the same speed and direction' },
        { id: 'slows', label: 'B', text: 'It gradually slows to a stop' },
        { id: 'speeds-up', label: 'C', text: 'It continues to speed up' },
        { id: 'unsure', label: 'D', text: 'I am not sure' },
      ],
    },
    transfer: {
      id: 'motion-transfer',
      context: 'An elevator travels upward in a straight line at constant speed. Its only vertical forces are cable tension upward and weight downward.',
      prompt: 'Is the cable tension greater than, equal to, or less than the elevator’s weight? Explain using the motion described.',
      options: [
        { id: 'greater', label: 'A', text: 'Greater than its weight' },
        { id: 'equal', label: 'B', text: 'Equal to its weight' },
        { id: 'less', label: 'C', text: 'Less than its weight' },
        { id: 'unsure', label: 'D', text: 'I am not sure' },
      ],
    },
    initialExpectedChoiceId: 'constant',
    transferExpectedChoiceId: 'equal',
    initialExpectedReasoning: 'No net horizontal external force means no horizontal acceleration, so horizontal velocity remains unchanged. Continuing motion does not require a continuing push. Inertia is not an additional force.',
    transferExpectedReasoning: 'Constant speed in a straight line means zero acceleration. The vertical resultant force is zero, so upward tension equals downward weight. Upward velocity does not imply a net upward force.',
    categories: [
      {
        id: 'zero-net-force', label: 'Links unchanged velocity to zero net force',
        description: 'Explicitly connects zero net horizontal force to no acceleration or unchanged horizontal velocity. Compatible with momentum reasoning. Do not use solely because the selected answer is constant velocity.',
        probeId: 'forces-probe',
      },
      {
        id: 'momentum', label: 'Uses conservation of horizontal momentum',
        description: 'Explicitly says horizontal momentum is unchanged because no net horizontal external force acts. Compatible with zero-net-force reasoning. Momentum must not be described as a stored force.',
        probeId: 'forces-probe',
      },
      {
        id: 'stored-force', label: 'Describes a continuing stored push',
        description: 'Explicitly claims the motor’s original force remains inside the puck or continues pushing after switch-off. Do not use for valid references to momentum, inertia, or energy unless described as a continuing horizontal force.',
        probeId: 'forces-probe',
      },
      {
        id: 'force-needed', label: 'Says motion needs a continuing force',
        description: 'Explicitly claims the puck must slow or stop because no force keeps it moving. Do not infer this reasoning solely from selecting slows; other explanations may be out of scope.',
        probeId: 'forces-probe',
      },
      {
        id: 'unclear', label: 'Needs a little more explanation',
        description: 'The explanation is too brief, ambiguous, internally conflicting, outside these categories, or does not explicitly support a category. This is not evidence of poor understanding.',
        probeId: 'forces-probe',
      },
    ],
    probes: [
      {
        id: 'forces-probe',
        prompt: 'After the motor switches off, list the horizontal forces acting on the puck under the stated conditions. Which, if any, changes its horizontal velocity?',
        expectedReasoning: 'There are no horizontal external forces in the stated ideal situation. The vertical normal force balances weight. No horizontal acceleration follows; motion is not itself a force.',
      },
    ],
    contrastPairs: [
      ['zero-net-force', 'stored-force'],
      ['momentum', 'stored-force'],
      ['zero-net-force', 'force-needed'],
      ['momentum', 'force-needed'],
    ],
    defaultDiscussionPrompt: 'Compare your explanations with a list of forces actually acting on the puck. Does continuing motion require a continuing horizontal force? Explain what changes velocity and what can remain unchanged. You do not have to disagree.',
    demoResponses: [
      {
        alias: 'Amber', choiceId: 'constant',
        reason: 'Its velocity stays constant because there is no net horizontal force to change it.',
        categoryId: 'zero-net-force',
        quote: 'Its velocity stays constant because there is no net horizontal force to change it.',
        transferChoiceId: 'equal',
        transferReason: 'Equal: constant speed in a straight line means zero acceleration, so upward tension balances weight.',
      },
      {
        alias: 'Birch', choiceId: 'constant',
        reason: 'Its horizontal momentum stays unchanged because no horizontal external force acts.',
        categoryId: 'momentum',
        quote: 'Its horizontal momentum stays unchanged because no horizontal external force acts.',
        transferChoiceId: 'equal',
        transferReason: 'Its momentum is constant, so the net force is zero. Tension and weight must balance.',
      },
      {
        alias: 'Cedar', choiceId: 'constant',
        reason: 'It keeps moving because the motor’s original force stays inside the puck and keeps pushing it.',
        categoryId: 'stored-force',
        quote: 'It keeps moving because the motor’s original force stays inside the puck and keeps pushing it.',
        transferChoiceId: 'equal',
        transferReason: 'It is moving upward but not speeding up, so it does not need a net upward force. Tension equals weight.',
      },
      {
        alias: 'Dune', choiceId: 'constant',
        reason: 'It keeps going, but I am not sure why.',
        categoryId: 'unclear',
        quote: 'It keeps going, but I am not sure why.',
        transferChoiceId: 'greater',
        transferReason: 'I still think the upward force must be greater because the elevator is moving upward.',
      },
      {
        alias: 'Elm', choiceId: 'slows',
        reason: 'It slows down because there is no longer a force to keep it moving.',
        categoryId: 'force-needed',
        quote: 'It slows down because there is no longer a force to keep it moving.',
        transferChoiceId: 'equal',
        transferReason: 'Constant velocity means no acceleration. If tension were greater, it would speed up, so the forces must be equal.',
      },
      {
        alias: 'Fern', choiceId: 'constant',
        reason: 'With zero horizontal resultant force, horizontal acceleration is zero and velocity stays the same.',
        categoryId: 'zero-net-force',
        quote: 'With zero horizontal resultant force, horizontal acceleration is zero and velocity stays the same.',
        transferChoiceId: 'equal',
        transferReason: 'The forces balance because its vertical acceleration is zero, even though its vertical velocity is not zero.',
      },
    ],
  },
];

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((lesson) => lesson.id === id);
}

/** Explicit allowlist: answer keys, rubrics, probes and demonstration answers stay on the server. */
export function toPublicLesson(lesson: Lesson): PublicLesson {
  return structuredClone({
    id: lesson.id,
    title: lesson.title,
    subject: lesson.subject,
    subtitle: lesson.subtitle,
    estimatedMinutes: lesson.estimatedMinutes,
    initial: lesson.initial,
    transfer: lesson.transfer,
  });
}
