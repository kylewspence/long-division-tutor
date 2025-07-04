import { useState, useCallback } from 'react';
import type { AdditionProblem, AdditionUserAnswer, AdditionGameState, AdditionStep } from '../types/addition';
import { ADDITION_LEVELS, PROBLEMS_PER_LEVEL } from '../utils/constants';
import { generateAdditionProblem } from '../utils/additionGenerator';
import { validateAdditionAnswer, isAdditionProblemComplete } from '../utils/additionValidator';
import { fetchAdditionProblems } from '../utils/apiService';
import { FEATURES } from '../utils/config';

// Minimum number of problems needed per level before falling back to local generation
const MIN_PROBLEMS_PER_LEVEL = 8;

/**
 * Generates a problem specifically for the given level ID
 */
function generateLevelSpecificAdditionProblem(levelId: number): AdditionProblem {
    const level = ADDITION_LEVELS.find(l => l.id === levelId);
    if (!level) {
        throw new Error(`Addition level ${levelId} not found`);
    }

    // Generate the problem with full computation using the level object
    const problem = generateAdditionProblem(level);

    return problem;
}

/**
 * Custom hook to manage the addition game state
 */
export function useAdditionGameState() {
    // Complete game state
    const [gameState, setGameState] = useState<AdditionGameState>({
        currentLevel: 1,
        completedLevels: [],
        availableLevels: [1],
        currentProblemIndex: 0,
        levelProblems: [],
        problem: null,
        userAnswers: [],
        isSubmitted: false,
        isComplete: false,
        score: 0,
        gameMode: 'addition',
    });

    // Loading state
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [fetchError, setFetchError] = useState<string | null>(null);

    // Load problems for a specific level
    const loadProblemsForLevel = useCallback(async (levelId: number) => {
        setIsLoading(true);
        setFetchError(null);

        try {
            let problems: AdditionProblem[] = [];

            // Only fetch from API if feature is enabled
            if (FEATURES.USE_API_PROBLEMS) {
                // Fetch from API first
                const apiProblems = await fetchAdditionProblems(levelId);
                problems = [...apiProblems];
            }

            // If we don't have enough from the API, supplement with local generation
            const MIN_PROBLEMS_FROM_API = 8;
            if (problems.length < MIN_PROBLEMS_FROM_API) {
                const localProblemsNeeded = PROBLEMS_PER_LEVEL - problems.length;
                const localProblems = Array.from({ length: localProblemsNeeded },
                    () => generateLevelSpecificAdditionProblem(levelId));

                problems = [...problems, ...localProblems];
            }

            // Limit to 10 problems and shuffle
            problems = problems.slice(0, PROBLEMS_PER_LEVEL);
            problems = shuffleArray(problems);

            setGameState(prev => ({
                ...prev,
                levelProblems: problems,
                currentProblemIndex: 0,
                problem: problems.length > 0 ? problems[0] : null,
                userAnswers: [],
                isSubmitted: false,
            }));
        } catch (error) {
            // Error loading addition problems
            setFetchError('Failed to load problems. Please try again.');

            // Fallback to locally generated problems
            const fallbackProblems = Array.from({ length: PROBLEMS_PER_LEVEL },
                () => generateLevelSpecificAdditionProblem(levelId));

            setGameState(prev => ({
                ...prev,
                levelProblems: fallbackProblems,
                currentProblemIndex: 0,
                problem: fallbackProblems.length > 0 ? fallbackProblems[0] : null,
                userAnswers: [],
                isSubmitted: false,
            }));
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Initialize game state
    const initializeGame = useCallback(async () => {
        // Load initial level
        await loadProblemsForLevel(1);

        // Initialize available levels based on feature flags
        let initialLevels = [1];
        if (FEATURES.ALLOW_LEVEL_SKIPPING) {
            initialLevels = ADDITION_LEVELS.map(l => l.id);
        }

        setGameState(prev => ({
            ...prev,
            availableLevels: initialLevels,
            completedLevels: [],
            currentLevel: 1,
            score: 0,
            gameMode: 'addition',
        }));
    }, [loadProblemsForLevel]);

    // Jump to a specific level
    const jumpToLevel = useCallback((levelId: number) => {
        // Check if the level exists
        if (!ADDITION_LEVELS.some(l => l.id === levelId)) {
            return;
        }

        // Reset problem state and load new level
        setGameState(prev => ({
            ...prev,
            currentLevel: levelId,
            userAnswers: [],
            isSubmitted: false,
            isComplete: false,
        }));

        // Load problems for the selected level
        loadProblemsForLevel(levelId);
    }, [loadProblemsForLevel]);

    // Restore exact game state without regenerating problems
    const restoreGameState = useCallback((levelId: number, problemIndex: number, problems: AdditionProblem[]) => {
        // Check if the level exists
        if (!ADDITION_LEVELS.some(l => l.id === levelId)) {
            return;
        }

        // Ensure problemIndex is within bounds
        const safeIndex = Math.max(0, Math.min(problemIndex, problems.length - 1));
        const currentProblem = problems[safeIndex] || null;

        // Restore exact state
        setGameState(prev => ({
            ...prev,
            currentLevel: levelId,
            currentProblemIndex: safeIndex,
            levelProblems: problems,
            problem: currentProblem,
            userAnswers: [], // Always clear user answers when restoring
            isSubmitted: false,
            isComplete: false,
        }));
    }, []);

    // Generate a new problem
    const generateNewProblem = useCallback(() => {
        setGameState(prev => {
            // If we have problems available for this level, use the next one
            if (prev.levelProblems.length > 0 && prev.currentProblemIndex < prev.levelProblems.length) {
                const nextProblem = prev.levelProblems[prev.currentProblemIndex];
                return {
                    ...prev,
                    problem: nextProblem,
                    userAnswers: [],
                    isSubmitted: false,
                    isComplete: false,
                };
            }

            // If we've run out of problems, generate a new one
            const newProblem = generateLevelSpecificAdditionProblem(prev.currentLevel);
            return {
                ...prev,
                problem: newProblem,
                userAnswers: [],
                isSubmitted: false,
                isComplete: false,
            };
        });
    }, []);

    // Update current problem (for editing)
    const updateProblem = useCallback((addend1: number, addend2: number) => {
        if (addend1 <= 0 || addend2 <= 0) {
            // Ensure positive numbers
            return;
        }

        // Find the current level object
        const currentLevel = ADDITION_LEVELS.find(l => l.id === gameState.currentLevel);
        if (!currentLevel) return;

        // Create a custom problem using the specific addends
        const updatedProblem = generateAdditionProblem(currentLevel, addend1, addend2);

        setGameState(prev => ({
            ...prev,
            problem: updatedProblem,
            userAnswers: [],
            isSubmitted: false,
            isComplete: false,
        }));
    }, [gameState.currentLevel]);

    // Submit an answer for a specific field
    const submitAnswer = useCallback((answer: AdditionUserAnswer) => {
        setGameState(prev => {
            // First remove any existing answer for the same field
            const filteredAnswers = prev.userAnswers.filter(a =>
                !(a.columnPosition === answer.columnPosition &&
                    a.fieldType === answer.fieldType)
            );

            // If problem was already submitted, mark new answers as pending (not validated)
            const newAnswer = prev.isSubmitted
                ? { ...answer, isCorrect: null as boolean | null } // Mark as pending
                : { ...answer, isCorrect: false as boolean | null }; // Default to false for initial submission

            // Add the new answer
            const updatedAnswers = [...filteredAnswers, newAnswer];

            // If problem was already submitted, we DON'T auto-validate
            // User must hit submit again to validate
            if (prev.isSubmitted) {
                return {
                    ...prev,
                    userAnswers: updatedAnswers,
                    isComplete: false, // Reset completion since answers changed
                };
            }

            // If not yet submitted, just update the answers
            return {
                ...prev,
                userAnswers: updatedAnswers,
            };
        });
    }, []);

    // Clear an answer for a specific field
    const clearAnswer = useCallback((columnPosition: number, fieldType: 'sum' | 'carry') => {
        setGameState(prev => {
            const filteredAnswers = prev.userAnswers.filter(a =>
                !(a.columnPosition === columnPosition &&
                    a.fieldType === fieldType)
            );

            // If problem was already submitted, we DON'T auto-validate
            // User must hit submit again to validate
            if (prev.isSubmitted) {
                return {
                    ...prev,
                    userAnswers: filteredAnswers,
                    isComplete: false, // Reset completion since answers changed
                };
            }

            // If not yet submitted, just update the answers
            return {
                ...prev,
                userAnswers: filteredAnswers,
            };
        });
    }, []);

    // Submit the entire problem for validation
    const submitProblem = useCallback(() => {
        setGameState(prev => {
            if (!prev.problem) return prev;

            // Validate each answer
            const validatedAnswers = prev.userAnswers.map(answer => {
                const isCorrect = validateAdditionAnswer(prev.problem!, answer);
                return { ...answer, isCorrect };
            });

            // Check if the problem is complete and all answers are correct
            const complete = isAdditionProblemComplete(prev.problem, validatedAnswers);

            // If complete and not previously submitted, update score and completed levels
            let updatedScore = prev.score;
            const completedLevels = [...prev.completedLevels];
            const availableLevels = [...prev.availableLevels];

            if (complete && !prev.isSubmitted) {
                updatedScore += 10; // Award points for completion

                // Mark level as completed if not already
                if (!completedLevels.includes(prev.currentLevel)) {
                    completedLevels.push(prev.currentLevel);
                }

                // Unlock next level if not already available
                const nextLevelId = prev.currentLevel + 1;
                if (nextLevelId <= ADDITION_LEVELS.length && !availableLevels.includes(nextLevelId)) {
                    availableLevels.push(nextLevelId);
                }
            }

            return {
                ...prev,
                userAnswers: validatedAnswers,
                isSubmitted: true,
                isComplete: complete,
                score: updatedScore,
                completedLevels,
                availableLevels,
            };
        });
    }, []);

    // Move to the next problem
    const nextProblem = useCallback(() => {
        setGameState(prev => {
            console.log('🔧 [ADDITION DEBUG] nextProblem called with state:', {
                currentProblemIndex: prev.currentProblemIndex,
                levelProblemsLength: prev.levelProblems.length,
                currentLevel: prev.currentLevel,
                availableLevels: prev.availableLevels
            });

            // If we have more problems in this level, move to the next one
            if (prev.currentProblemIndex < prev.levelProblems.length - 1) {
                const nextIndex = prev.currentProblemIndex + 1;
                console.log('🔧 [ADDITION DEBUG] Moving to next problem in level:', nextIndex);
                return {
                    ...prev,
                    currentProblemIndex: nextIndex,
                    problem: prev.levelProblems[nextIndex],
                    userAnswers: [],
                    isSubmitted: false,
                    isComplete: false,
                };
            }

            // If we've finished the last problem, advance to the next level if available
            const nextLevelId = prev.currentLevel + 1;
            console.log('🔧 [ADDITION DEBUG] Finished level, checking for next level:', nextLevelId, 'available levels:', prev.availableLevels);
            if (prev.availableLevels.includes(nextLevelId)) {
                console.log('🔧 [ADDITION DEBUG] Advancing to next level:', nextLevelId);
                // Advance to next level and load its problems
                // Note: This will trigger async problem loading, but we set level immediately
                // The loadProblemsForLevel call will update problems when async operation completes
                setTimeout(() => loadProblemsForLevel(nextLevelId), 0);

                return {
                    ...prev,
                    currentLevel: nextLevelId,
                    currentProblemIndex: 0,
                    problem: null, // Will be set by loadProblemsForLevel
                    userAnswers: [],
                    isSubmitted: false,
                    isComplete: false,
                };
            }

            // If no next level available, generate a new problem for current level
            console.log('🔧 [ADDITION DEBUG] No next level available, generating new problem for current level');
            const newProblem = generateLevelSpecificAdditionProblem(prev.currentLevel);
            return {
                ...prev,
                problem: newProblem,
                userAnswers: [],
                isSubmitted: false,
                isComplete: false,
            };
        });
    }, [loadProblemsForLevel]);

    // Enable problem editing
    const enableEditing = useCallback(() => {
        setGameState(prev => {
            if (!prev.problem) return prev;

            return {
                ...prev,
                problem: { ...prev.problem, isEditable: true },
                // Reset submission states when editing to allow resubmission
                isSubmitted: false,
                isComplete: false,
            };
        });
    }, []);

    // Disable problem editing
    const disableEditing = useCallback((newAddend1?: number, newAddend2?: number) => {
        setGameState(prev => {
            if (!prev.problem) return prev;

            let updatedProblem = prev.problem;
            let preservedAnswers = prev.userAnswers;

            // If new values were provided, update the problem
            if (newAddend1 !== undefined && newAddend2 !== undefined &&
                (newAddend1 !== prev.problem.addend1 || newAddend2 !== prev.problem.addend2)) {

                // Validate the new values
                if (newAddend1 > 0 && newAddend2 > 0) {
                    // Find the current level object
                    const currentLevel = ADDITION_LEVELS.find(l => l.id === prev.currentLevel);
                    if (currentLevel) {
                        // Generate a problem with the specific addends
                        updatedProblem = generateAdditionProblem(currentLevel, newAddend1, newAddend2);

                        // Try to preserve existing answers that are still valid for the new problem
                        // Only keep answers that match the new problem structure
                        preservedAnswers = prev.userAnswers.filter(answer => {
                            // Check if this answer is still valid for the new problem structure
                            const step = updatedProblem.steps.find(s => s.columnPosition === answer.columnPosition);
                            if (!step) return false;

                            // All field types (sum and carry) are valid as long as the column exists
                            return true;
                        });

                        return {
                            ...prev,
                            problem: { ...updatedProblem, isEditable: false },
                            userAnswers: preservedAnswers,
                            isSubmitted: false,
                            isComplete: false,
                        };
                    }
                }
            }

            return {
                ...prev,
                problem: { ...updatedProblem, isEditable: false },
            };
        });
    }, []);

    return {
        gameState,
        generateNewProblem,
        submitAnswer,
        submitProblem,
        clearAnswer,
        nextProblem,
        jumpToLevel,
        restoreGameState,
        initializeGame,
        updateProblem,
        enableEditing,
        disableEditing,
        isLoading,
        fetchError,
        loadProblemsForLevel,
    };
}

// Helper function to shuffle an array
function shuffleArray<T>(array: T[]): T[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// Helper function to calculate addition steps
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function calculateAdditionSteps(addend1: number, addend2: number): AdditionStep[] {
    const addend1Str = addend1.toString();
    const addend2Str = addend2.toString();

    // Determine the maximum number of digits
    const maxLength = Math.max(addend1Str.length, addend2Str.length);

    let carryValue = 0; // Initialize carry
    const steps: AdditionStep[] = [];

    // Process each column from right to left (ones, tens, hundreds, etc.)
    for (let i = 0; i < maxLength; i++) {
        // Get digits from right to left (or 0 if position doesn't exist)
        const digit1 = parseInt(addend1Str[addend1Str.length - 1 - i] || '0');
        const digit2 = parseInt(addend2Str[addend2Str.length - 1 - i] || '0');

        // Calculate column sum including any carry from previous column
        const columnSum = digit1 + digit2 + carryValue;

        // Determine if we need to carry to the next column
        const nextCarry = columnSum >= 10 ? 1 : 0;

        // The digit that goes in the sum (ones digit of columnSum)
        const sumDigit = columnSum % 10;

        // Create the step
        const step = {
            stepNumber: i,
            columnPosition: i,
            digit1,
            digit2,
            sum: sumDigit,
            carry: nextCarry,
            carryReceived: carryValue
        };

        steps.push(step);

        // Update carry for next iteration
        carryValue = nextCarry;
    }

    // If there's a final carry, add it as the most significant digit
    if (carryValue > 0) {
        steps.push({
            stepNumber: maxLength,
            columnPosition: maxLength,
            digit1: 0,
            digit2: 0,
            sum: carryValue,
            carry: 0,
            carryReceived: 0
        });
    }

    return steps;
} 