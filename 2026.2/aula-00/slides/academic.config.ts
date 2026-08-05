/**
 * Informações acadêmicas compartilhadas pela capa e pelo rodapé.
 *
 * Edite somente este objeto ao reutilizar o template para outra apresentação.
 */
export interface AcademicPresentation {
  courseName: string
  subjectName: string
  subjectAcronym: string
  subjectCode: string
  professorName: string
  professorContact: string
  presentationTitle: string
}

export const academicConfig = {
  courseName: 'Bacharelado em Sistemas de Informação',
  subjectName: 'Trabalho de Conclusão de Curso II',
  subjectAcronym: 'TCCII',
  subjectCode: 'INF03094',
  professorName: 'Filipe Fernandes, PhD',
  professorContact: 'filipe.fernandes@ifsudestemg.edu.br',
  presentationTitle: 'Programa Analítico da Disciplina',
} satisfies AcademicPresentation

