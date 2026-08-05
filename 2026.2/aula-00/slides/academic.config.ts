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
  courseName: 'Nome do curso',
  subjectName: 'Nome da disciplina',
  subjectAcronym: 'SIGLA',
  subjectCode: 'COD-0000',
  professorName: 'Prof. Nome do Professor',
  professorContact: 'professor@instituicao.br',
  presentationTitle: 'Título da apresentação',
} satisfies AcademicPresentation

