'use server';
/**
 * @fileOverview An AI assistant for generating standardized descriptions for position requirements.
 *
 * - generatePositionRequirements - A function that handles the generation of position requirement descriptions.
 * - GeneratePositionRequirementsInput - The input type for the generatePositionRequirements function.
 * - GeneratePositionRequirementsOutput - The return type for the generatePositionRequirements function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GeneratePositionRequirementsInputSchema = z.object({
  positionName: z.string().describe('The name or type of the position (e.g., "Offshore Welder", "HR Manager").'),
  requirementsType: z.enum(['certificate', 'ppe', 'tool']).describe('The type of requirements to generate a description for (e.g., "certificate", "ppe", "tool").'),
  additionalDetails: z.string().optional().describe('Any additional specific details or context that should be included in the description.'),
});
export type GeneratePositionRequirementsInput = z.infer<typeof GeneratePositionRequirementsInputSchema>;

const GeneratePositionRequirementsOutputSchema = z.object({
  description: z.string().describe('A clear, standardized, and comprehensive description of the position requirements.'),
});
export type GeneratePositionRequirementsOutput = z.infer<typeof GeneratePositionRequirementsOutputSchema>;

export async function generatePositionRequirements(input: GeneratePositionRequirementsInput): Promise<GeneratePositionRequirementsOutput> {
  return generatePositionRequirementsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generatePositionRequirementsPrompt',
  input: {schema: GeneratePositionRequirementsInputSchema},
  output: {schema: GeneratePositionRequirementsOutputSchema},
  prompt: `You are an AI assistant designed to generate clear, standardized, and comprehensive descriptions for specific position requirements.
Your goal is to help HR Managers quickly define accurate requirements for various positions, ensuring consistency and compliance within the system.

Generate a detailed description for the '{{{requirementsType}}} requirements' for the position of '{{{positionName}}}'.

Focus on clarity, conciseness, and completeness. Ensure the description is standardized and can be easily understood.

{{#if additionalDetails}}
Consider the following additional details:
"""{{{additionalDetails}}}"""
{{/if}}

Provide the description in a structured format, suitable for official documentation.`,
});

const generatePositionRequirementsFlow = ai.defineFlow(
  {
    name: 'generatePositionRequirementsFlow',
    inputSchema: GeneratePositionRequirementsInputSchema,
    outputSchema: GeneratePositionRequirementsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    if (!output) {
      throw new Error('Failed to generate position requirements description.');
    }
    return output;
  }
);
